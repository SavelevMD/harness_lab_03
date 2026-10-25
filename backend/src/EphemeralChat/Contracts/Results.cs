using EphemeralChat.Models;

namespace EphemeralChat.Contracts;

public enum CreateStatus
{
    Success,
    InvalidNickname,
}

public enum JoinStatus
{
    Success,
    InvalidNickname,
    RoomNotFound,
    RoomFull,
}

public sealed record CreateResult(CreateStatus Status, Room? Room = null);

public sealed record JoinResult(JoinStatus Status, Room? Room = null, Participant? Participant = null);
