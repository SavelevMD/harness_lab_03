using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using EphemeralChat.Contracts;
using EphemeralChat.Models;
using Microsoft.Extensions.Logging;

namespace EphemeralChat.Services;

public interface IConnectionManager : IHostedService
{
    /// <summary>Handles the lifetime of a single WebSocket signaling connection.</summary>
    Task HandleAsync(HttpContext context);

    /// <summary>Sends a JSON text frame to the participant if connected.</summary>
    Task SendAsync(string participantId, string json);

    /// <summary>True if the participant currently has a live socket.</summary>
    bool IsConnected(string participantId);
}

/// <summary>
/// Owns the live WebSocket connections and the signaling relay. Also runs a
/// heartbeat monitor that drops connections silent for more than 10 seconds,
/// which is how silent host drops are detected.
/// </summary>
public sealed class ConnectionManager : IConnectionManager
{
    private static readonly TimeSpan HeartbeatTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan MonitorInterval = TimeSpan.FromSeconds(1);

    private readonly ConcurrentDictionary<string, WebSocket> _sockets = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _lastActivity = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _sendLocks = new(StringComparer.Ordinal);

    private readonly IRoomRegistry _registry;
    private readonly ILogger<ConnectionManager> _logger;
    private readonly JsonSerializerOptions _jsonOptions;
    private CancellationTokenSource? _cts;

    public ConnectionManager(IRoomRegistry registry, ILogger<ConnectionManager> logger)
    {
        _registry = registry;
        _logger = logger;
        _jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
    }

    public bool IsConnected(string participantId) => _sockets.ContainsKey(participantId);

    public async Task HandleAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        string code = context.Request.Query["room"].ToString();
        string participantId = context.Request.Query["participantId"].ToString();
        string token = context.Request.Query["token"].ToString();

        WebSocket socket;
        try
        {
            socket = await context.WebSockets.AcceptWebSocketAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to accept WebSocket connection.");
            return;
        }

        var room = _registry.Find(code);
        if (room is null || room.IsDead)
        {
            await SendErrorAndCloseAsync(socket, ErrorCodes.RoomNotFound, ErrorMessages.RoomNotFound);
            return;
        }

        var participant = room.FindParticipant(participantId);
        if (participant is null || !string.Equals(participant.Token, token, StringComparison.Ordinal))
        {
            await SendErrorAndCloseAsync(socket, ErrorCodes.InvalidToken, ErrorMessages.InvalidToken);
            return;
        }

        if (_sockets.ContainsKey(participant.Id))
        {
            await SendErrorAndCloseAsync(socket, ErrorCodes.InvalidToken, ErrorMessages.AlreadyConnected);
            return;
        }

        _sockets[participant.Id] = socket;
        _lastActivity[participant.Id] = DateTimeOffset.UtcNow;

        try
        {
            if (participant.IsHost)
            {
                _registry.SetHostConnected(room, true);
            }

            await SendJoinedAsync(room, participant);

            var presence = new PresenceMessage(
                "presence",
                room.Participants.Select(ToInfo).ToList(),
                "join",
                ToInfo(participant));
            await BroadcastToRoomAsync(room, Serialize(presence), excludeId: participant.Id);

            await ReceiveLoopAsync(room, participant, socket);
        }
        finally
        {
            _sockets.TryRemove(participant.Id, out _);
            _lastActivity.TryRemove(participant.Id, out _);
            _sendLocks.TryRemove(participant.Id, out _);

            try
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
                }
            }
            catch
            {
                // ignore close failures
            }

            socket.Dispose();

            await HandleLeaveAsync(room, participant);
        }
    }

    public async Task SendAsync(string participantId, string json)
    {
        if (!_sockets.TryGetValue(participantId, out var socket) || socket.State != WebSocketState.Open)
        {
            return;
        }

        var sendLock = _sendLocks.GetOrAdd(participantId, static _ => new SemaphoreSlim(1, 1));
        await sendLock.WaitAsync();
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                await socket.SendAsync(
                    new ArraySegment<byte>(bytes),
                    WebSocketMessageType.Text,
                    endOfMessage: true,
                    CancellationToken.None);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to send message to participant {ParticipantId}.", participantId);
        }
        finally
        {
            sendLock.Release();
        }
    }

    private async Task ReceiveLoopAsync(Room room, Participant participant, WebSocket socket)
    {
        var buffer = new byte[16 * 1024];
        using var memory = new MemoryStream();

        while (socket.State == WebSocketState.Open)
        {
            memory.SetLength(0);

            WebSocketReceiveResult result;
            try
            {
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }

                    memory.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage && socket.State == WebSocketState.Open);
            }
            catch (WebSocketException)
            {
                return;
            }
            catch (OperationCanceledException)
            {
                return;
            }

            _lastActivity[participant.Id] = DateTimeOffset.UtcNow;

            if (result.MessageType == WebSocketMessageType.Text)
            {
                var text = Encoding.UTF8.GetString(memory.ToArray());
                await ProcessMessageAsync(room, participant, text);
            }
        }
    }

    private async Task ProcessMessageAsync(Room room, Participant from, string text)
    {
        InboundMessage? message;
        try
        {
            message = JsonSerializer.Deserialize<InboundMessage>(text, _jsonOptions);
        }
        catch (JsonException)
        {
            return;
        }

        if (message is null)
        {
            return;
        }

        switch (message.Type)
        {
            case "signal":
                await HandleSignalAsync(room, from, message);
                break;
            case "heartbeat":
                // activity already recorded
                break;
            default:
                break;
        }
    }

    private async Task HandleSignalAsync(Room room, Participant from, InboundMessage message)
    {
        var toId = message.To;
        if (string.IsNullOrWhiteSpace(toId) || message.Payload is null)
        {
            return;
        }

        // Star topology only: drop client -> client signaling.
        if (!SignalRelayPolicy.CanRelay(room, from.Id, toId))
        {
            return;
        }

        var target = room.FindParticipant(toId);
        if (target is null)
        {
            return;
        }

        var outgoing = new SignalMessage("signal", from.Id, message.Payload.Value);
        await SendAsync(target.Id, Serialize(outgoing));
    }

    private async Task HandleLeaveAsync(Room room, Participant participant)
    {
        if (room.IsDead)
        {
            return;
        }

        if (participant.IsHost)
        {
            var clients = _registry.HandleHostLeft(room);
            var json = Serialize(new HostLeftMessage("host_left", ErrorMessages.HostLeft));
            foreach (var client in clients)
            {
                await SendAsync(client.Id, json);
                await CloseSocketAsync(client.Id);
            }
        }
        else
        {
            bool removed = _registry.RemoveParticipant(room, participant.Id);
            if (!removed)
            {
                return;
            }

            var presence = new PresenceMessage(
                "presence",
                room.Participants.Select(ToInfo).ToList(),
                "leave",
                ToInfo(participant));
            await BroadcastToRoomAsync(room, Serialize(presence));
        }
    }

    private async Task BroadcastToRoomAsync(Room room, string json, string? excludeId = null)
    {
        foreach (var participant in room.Participants)
        {
            if (excludeId is not null && string.Equals(participant.Id, excludeId, StringComparison.Ordinal))
            {
                continue;
            }

            await SendAsync(participant.Id, json);
        }
    }

    private Task SendJoinedAsync(Room room, Participant self)
    {
        var message = new JoinedMessage(
            "joined",
            self.Id,
            room.HostId,
            room.Code,
            room.Participants.Select(ToInfo).ToList());
        return SendAsync(self.Id, Serialize(message));
    }

    private async Task CloseSocketAsync(string participantId)
    {
        if (_sockets.TryRemove(participantId, out var socket))
        {
            try
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "host left", CancellationToken.None);
                }
            }
            catch
            {
                // ignore
            }

            try
            {
                socket.Dispose();
            }
            catch
            {
                // ignore
            }
        }

        _lastActivity.TryRemove(participantId, out _);
        _sendLocks.TryRemove(participantId, out _);
    }

    private async Task SendErrorAndCloseAsync(WebSocket socket, string code, string message)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(Serialize(new ErrorMessage("error", code, message)));
            await socket.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text,
                endOfMessage: true,
                CancellationToken.None);
        }
        catch
        {
            // ignore
        }

        try
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "error", CancellationToken.None);
        }
        catch
        {
            // ignore
        }

        socket.Dispose();
    }

    private string Serialize<T>(T value) => JsonSerializer.Serialize(value, _jsonOptions);

    private static ParticipantInfo ToInfo(Participant participant) => new(participant.Id, participant.Nickname);

    // ---- Heartbeat monitor (IHostedService) ----

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => MonitorLoopAsync(_cts.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _cts?.Cancel();
        return Task.CompletedTask;
    }

    private async Task MonitorLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(MonitorInterval, token);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            DateTimeOffset now = DateTimeOffset.UtcNow;
            foreach (var (participantId, socket) in _sockets.ToArray())
            {
                if (_lastActivity.TryGetValue(participantId, out var last) && now - last > HeartbeatTimeout)
                {
                    _logger.LogWarning("Heartbeat timeout for participant {ParticipantId}; dropping connection.", participantId);
                    try
                    {
                        socket.Abort();
                    }
                    catch
                    {
                        // ignore
                    }
                }
            }
        }
    }
}
