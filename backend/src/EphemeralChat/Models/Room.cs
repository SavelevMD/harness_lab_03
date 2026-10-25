namespace EphemeralChat.Models;

/// <summary>
/// An in-memory chat room. A room has a single HOST (creator) and up to 19
/// additional CLIENTS. Participants are kept in insertion order.
/// </summary>
public sealed class Room
{
    private readonly object _gate = new();
    private readonly List<Participant> _participants;

    public Room(string code, Participant host)
    {
        Code = code;
        HostId = host.Id;
        _participants = new List<Participant> { host };
    }

    /// <summary>Case-insensitive room code (base32, 6 chars).</summary>
    public string Code { get; }

    /// <summary>Participant id of the host (room creator).</summary>
    public string HostId { get; }

    public bool IsDead
    {
        get { lock (_gate) return _dead; }
        private set { lock (_gate) _dead = value; }
    }

    public bool HostConnected
    {
        get { lock (_gate) return _hostConnected; }
        private set { lock (_gate) _hostConnected = value; }
    }

    private bool _dead;
    private bool _hostConnected;

    public Participant? Host
    {
        get
        {
            lock (_gate)
            {
                return _participants.FirstOrDefault(p => string.Equals(p.Id, HostId, StringComparison.Ordinal));
            }
        }
    }

    public int ParticipantCount
    {
        get { lock (_gate) return _participants.Count; }
    }

    public IReadOnlyList<Participant> Participants
    {
        get { lock (_gate) return _participants.ToList(); }
    }

    public Participant? FindParticipant(string? participantId)
    {
        if (string.IsNullOrEmpty(participantId))
        {
            return null;
        }

        lock (_gate)
        {
            return _participants.FirstOrDefault(p => string.Equals(p.Id, participantId, StringComparison.Ordinal));
        }
    }

    public bool TryAddParticipant(Participant participant, int maxParticipants)
    {
        lock (_gate)
        {
            if (_dead)
            {
                return false;
            }

            if (_participants.Count >= maxParticipants)
            {
                return false;
            }

            if (_participants.Any(p => string.Equals(p.Id, participant.Id, StringComparison.Ordinal)))
            {
                return false;
            }

            _participants.Add(participant);
            return true;
        }
    }

    public bool RemoveParticipant(string participantId)
    {
        lock (_gate)
        {
            int removed = _participants.RemoveAll(p => string.Equals(p.Id, participantId, StringComparison.Ordinal));
            return removed > 0;
        }
    }

    public void SetHostConnected(bool connected)
    {
        lock (_gate) _hostConnected = connected;
    }

    public void MarkDead()
    {
        lock (_gate)
        {
            _dead = true;
            _hostConnected = false;
        }
    }
}
