using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace EphemeralChat.Tests;

/// <summary>
/// End-to-end signaling tests over a real (in-memory) WebSocket connection,
/// exercising the full host/client flow and the star-topology relay.
/// </summary>
public class SignalingIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public SignalingIntegrationTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task FullFlow_HostAndClient_SignalRelayed_AndHostLeftPropagates()
    {
        var http = _factory.CreateClient();

        // 1. Host creates the room.
        var createResponse = await http.PostAsJsonAsync("/api/rooms", new { nickname = "Host" });
        var create = await ReadJsonAsync(createResponse);
        string code = create.GetProperty("code").GetString()!;
        string hostId = create.GetProperty("participantId").GetString()!;
        string hostToken = create.GetProperty("token").GetString()!;
        Assert.True(create.GetProperty("isHost").GetBoolean());

        // 2. Host connects its WebSocket.
        using var hostWs = await ConnectAsync(code, hostId, hostToken);

        var hostJoined = await ReceiveJsonAsync(hostWs);
        Assert.Equal("joined", hostJoined.GetProperty("type").GetString());
        Assert.Equal(hostId, hostJoined.GetProperty("selfId").GetString());
        Assert.Equal(hostId, hostJoined.GetProperty("hostId").GetString());
        Assert.Equal(code, hostJoined.GetProperty("code").GetString());

        // 3. Client joins over REST (room is now live because host is connected).
        var joinResponse = await http.PostAsJsonAsync($"/api/rooms/{code}/join", new { nickname = "Client" });
        Assert.Equal(HttpStatusCode.OK, joinResponse.StatusCode);
        var join = await ReadJsonAsync(joinResponse);
        string clientId = join.GetProperty("participantId").GetString()!;
        string clientToken = join.GetProperty("token").GetString()!;
        Assert.False(join.GetProperty("isHost").GetBoolean());
        Assert.Equal(hostId, join.GetProperty("hostId").GetString());

        // 4. Client connects its WebSocket.
        using var clientWs = await ConnectAsync(code, clientId, clientToken);

        var clientJoined = await ReceiveJsonAsync(clientWs);
        Assert.Equal("joined", clientJoined.GetProperty("type").GetString());
        Assert.Equal(clientId, clientJoined.GetProperty("selfId").GetString());

        // 5. Host receives a presence "join" event for the client.
        var presenceJoin = await ReceiveJsonAsync(hostWs);
        Assert.Equal("presence", presenceJoin.GetProperty("type").GetString());
        Assert.Equal("join", presenceJoin.GetProperty("event").GetString());
        Assert.Equal(clientId, presenceJoin.GetProperty("participant").GetProperty("id").GetString());

        // 6. Client -> host signal is relayed (allowed direction).
        await SendJsonAsync(clientWs, new
        {
            type = "signal",
            to = hostId,
            payload = new { type = "offer", sdp = "v=0" },
        });

        var hostSignal = await ReceiveJsonAsync(hostWs);
        Assert.Equal("signal", hostSignal.GetProperty("type").GetString());
        Assert.Equal(clientId, hostSignal.GetProperty("from").GetString());
        Assert.Equal("offer", hostSignal.GetProperty("payload").GetProperty("type").GetString());

        // 7. Host -> client signal is relayed (allowed direction).
        await SendJsonAsync(hostWs, new
        {
            type = "signal",
            to = clientId,
            payload = new { type = "answer", sdp = "v=0" },
        });

        var clientSignal = await ReceiveJsonAsync(clientWs);
        Assert.Equal("signal", clientSignal.GetProperty("type").GetString());
        Assert.Equal(hostId, clientSignal.GetProperty("from").GetString());
        Assert.Equal("answer", clientSignal.GetProperty("payload").GetProperty("type").GetString());

        // 8. Host disconnects -> client receives host_left.
        await hostWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);

        var hostLeft = await ReceiveJsonAsync(clientWs);
        Assert.Equal("host_left", hostLeft.GetProperty("type").GetString());
        Assert.Equal("Хост покинул чат. Комната закрыта.", hostLeft.GetProperty("message").GetString());

        // 9. Room is now unjoinable.
        var afterLeft = await http.PostAsJsonAsync($"/api/rooms/{code}/join", new { nickname = "Late" });
        Assert.Equal(HttpStatusCode.NotFound, afterLeft.StatusCode);
    }

    [Fact]
    public async Task Join_RejectsTwentyFirstParticipantWith409()
    {
        var http = _factory.CreateClient();

        var createResponse = await http.PostAsJsonAsync("/api/rooms", new { nickname = "Host" });
        var create = await ReadJsonAsync(createResponse);
        string code = create.GetProperty("code").GetString()!;
        string hostId = create.GetProperty("participantId").GetString()!;
        string hostToken = create.GetProperty("token").GetString()!;

        using var hostWs = await ConnectAsync(code, hostId, hostToken);
        await ReceiveJsonAsync(hostWs); // joined

        // Fill the remaining 19 seats (host is #1).
        for (int i = 0; i < 19; i++)
        {
            var joinResponse = await http.PostAsJsonAsync($"/api/rooms/{code}/join", new { nickname = $"Client{i}" });
            Assert.Equal(HttpStatusCode.OK, joinResponse.StatusCode);
        }

        // 21st participant -> 409 room_full.
        var full = await http.PostAsJsonAsync($"/api/rooms/{code}/join", new { nickname = "Overflow" });
        Assert.Equal(HttpStatusCode.Conflict, full.StatusCode);

        var body = await ReadJsonAsync(full);
        Assert.Equal("room_full", body.GetProperty("error").GetString());
        Assert.Equal("Комната заполнена (макс. 20)", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Connect_WithInvalidToken_ReturnsError()
    {
        var http = _factory.CreateClient();

        var createResponse = await http.PostAsJsonAsync("/api/rooms", new { nickname = "Host" });
        var create = await ReadJsonAsync(createResponse);
        string code = create.GetProperty("code").GetString()!;
        string hostId = create.GetProperty("participantId").GetString()!;

        using var ws = await ConnectAsync(code, hostId, "wrong-token");

        var error = await ReceiveJsonAsync(ws);
        Assert.Equal("error", error.GetProperty("type").GetString());
        Assert.Equal("invalid_token", error.GetProperty("code").GetString());
    }

    // ---- helpers ----

    private async Task<WebSocket> ConnectAsync(string code, string participantId, string token)
    {
        var uri = new Uri($"ws://localhost/ws?room={Uri.EscapeDataString(code)}&participantId={Uri.EscapeDataString(participantId)}&token={Uri.EscapeDataString(token)}");
        return await _factory.Server.CreateWebSocketClient().ConnectAsync(uri, CancellationToken.None);
    }

    private static async Task SendJsonAsync(WebSocket socket, object value)
    {
        var json = JsonSerializer.Serialize(value);
        var bytes = Encoding.UTF8.GetBytes(json);
        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
    }

    private static async Task<JsonElement> ReceiveJsonAsync(WebSocket socket)
    {
        string text = await ReceiveStringAsync(socket);
        return JsonDocument.Parse(text).RootElement;
    }

    private static async Task<string> ReceiveStringAsync(WebSocket socket)
    {
        var buffer = new byte[8192];
        using var memory = new MemoryStream();

        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new InvalidOperationException("Socket closed before a text message was received.");
            }

            memory.Write(buffer, 0, result.Count);
        }
        while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(memory.ToArray());
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        string text = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(text).RootElement;
    }
}
