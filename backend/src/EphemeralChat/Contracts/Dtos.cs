using System.Text.Json;

namespace EphemeralChat.Contracts;

// ---- REST request/response models ----

public sealed record CreateRoomRequest(string? Nickname);

public sealed record CreateRoomResponse(string Code, string ParticipantId, string Token, bool IsHost);

public sealed record JoinRoomResponse(string Code, string ParticipantId, string Token, bool IsHost, string HostId);

public sealed record RoomProbeResponse(string Code, int ParticipantCount, bool Exists);

public sealed record ErrorResponse(string Error, string Message);

// ---- WebSocket message models ----

public sealed record ParticipantInfo(string Id, string Nickname);

/// <summary>Server -> client: initial roster after connecting.</summary>
public sealed record JoinedMessage(string Type, string SelfId, string HostId, string Code, IReadOnlyList<ParticipantInfo> Participants);

/// <summary>Server -> client: relayed WebRTC signaling payload.</summary>
public sealed record SignalMessage(string Type, string From, JsonElement Payload);

/// <summary>Server -> client: ordered participant list changed.</summary>
public sealed record PresenceMessage(string Type, IReadOnlyList<ParticipantInfo> Participants, string Event, ParticipantInfo Participant);

/// <summary>Server -> client: the host went away and the room is closed.</summary>
public sealed record HostLeftMessage(string Type, string Message);

/// <summary>Server -> client: an error occurred.</summary>
public sealed record ErrorMessage(string Type, string Code, string Message);

/// <summary>Client -> server: inbound message envelope.</summary>
public sealed class InboundMessage
{
    public string? Type { get; set; }

    public string? To { get; set; }

    public JsonElement? Payload { get; set; }
}
