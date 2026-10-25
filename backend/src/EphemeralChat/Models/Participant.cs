namespace EphemeralChat.Models;

/// <summary>
/// A single participant in a room. Identity is self-assigned (nickname) only;
/// no authentication. Each participant carries a random token used to
/// authenticate its WebSocket connection.
/// </summary>
public sealed class Participant
{
    public Participant(string id, string nickname, string token, bool isHost)
    {
        Id = id;
        Nickname = nickname;
        Token = token;
        IsHost = isHost;
    }

    public string Id { get; }

    public string Nickname { get; }

    public string Token { get; }

    public bool IsHost { get; }
}
