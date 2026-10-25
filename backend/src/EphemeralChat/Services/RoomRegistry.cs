using System.Collections.Concurrent;
using EphemeralChat.Contracts;
using EphemeralChat.Models;

namespace EphemeralChat.Services;

public interface IRoomRegistry
{
    /// <summary>Creates a room with the caller as HOST.</summary>
    CreateResult CreateRoom(string nickname);

    /// <summary>Joins an existing room as a CLIENT (host must be online).</summary>
    JoinResult Join(string code, string nickname);

    /// <summary>Raw case-insensitive lookup regardless of liveness.</summary>
    Room? Find(string code);

    /// <summary>Returns the room only if it exists, is not dead, and the host is connected.</summary>
    Room? Probe(string code);

    void SetHostConnected(Room room, bool connected);

    bool RemoveParticipant(Room room, string participantId);

    /// <summary>Marks the room dead and returns the remaining clients to notify.</summary>
    IReadOnlyList<Participant> HandleHostLeft(Room room);
}

public sealed class RoomRegistry : IRoomRegistry
{
    public const int MaxParticipants = 20;

    private readonly ConcurrentDictionary<string, Room> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly IRoomCodeGenerator _codeGenerator;

    public RoomRegistry(IRoomCodeGenerator codeGenerator)
    {
        _codeGenerator = codeGenerator;
    }

    public CreateResult CreateRoom(string nickname)
    {
        if (!NicknameValidator.IsValid(nickname))
        {
            return new CreateResult(CreateStatus.InvalidNickname);
        }

        var host = new Participant(
            Guid.NewGuid().ToString(),
            NicknameValidator.Normalize(nickname!),
            Guid.NewGuid().ToString(),
            isHost: true);

        for (int attempt = 0; attempt < 100; attempt++)
        {
            string code = _codeGenerator.Generate();
            var room = new Room(code, host);
            if (_rooms.TryAdd(code, room))
            {
                return new CreateResult(CreateStatus.Success, room);
            }
        }

        throw new InvalidOperationException("Could not generate a unique room code.");
    }

    public JoinResult Join(string code, string nickname)
    {
        if (!NicknameValidator.IsValid(nickname))
        {
            return new JoinResult(JoinStatus.InvalidNickname);
        }

        var room = Probe(code);
        if (room is null)
        {
            return new JoinResult(JoinStatus.RoomNotFound);
        }

        if (room.ParticipantCount >= MaxParticipants)
        {
            return new JoinResult(JoinStatus.RoomFull);
        }

        var participant = new Participant(
            Guid.NewGuid().ToString(),
            NicknameValidator.Normalize(nickname!),
            Guid.NewGuid().ToString(),
            isHost: false);

        if (!room.TryAddParticipant(participant, MaxParticipants))
        {
            return new JoinResult(JoinStatus.RoomFull);
        }

        return new JoinResult(JoinStatus.Success, room, participant);
    }

    public Room? Find(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return null;
        }

        return _rooms.TryGetValue(code, out var room) ? room : null;
    }

    public Room? Probe(string code)
    {
        var room = Find(code);
        if (room is null || room.IsDead || !room.HostConnected)
        {
            return null;
        }

        return room;
    }

    public void SetHostConnected(Room room, bool connected) => room.SetHostConnected(connected);

    public bool RemoveParticipant(Room room, string participantId) => room.RemoveParticipant(participantId);

    public IReadOnlyList<Participant> HandleHostLeft(Room room)
    {
        var clients = room.Participants.Where(p => !p.IsHost).ToList();
        room.MarkDead();
        return clients;
    }
}
