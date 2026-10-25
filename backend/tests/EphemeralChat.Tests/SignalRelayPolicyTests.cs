using EphemeralChat.Models;
using EphemeralChat.Services;

namespace EphemeralChat.Tests;

public class SignalRelayPolicyTests
{
    private static (Room Room, Participant Host, Participant ClientA, Participant ClientB) CreateRoom()
    {
        var host = new Participant("host-1", "Host", "token-host", isHost: true);
        var room = new Room("ABC123", host);
        var clientA = new Participant("client-a", "A", "token-a", isHost: false);
        var clientB = new Participant("client-b", "B", "token-b", isHost: false);
        room.TryAddParticipant(clientA, 20);
        room.TryAddParticipant(clientB, 20);
        return (room, host, clientA, clientB);
    }

    [Fact]
    public void HostToClient_IsAllowed()
    {
        var (room, host, clientA, _) = CreateRoom();
        Assert.True(SignalRelayPolicy.CanRelay(room, host.Id, clientA.Id));
    }

    [Fact]
    public void ClientToHost_IsAllowed()
    {
        var (room, host, clientA, _) = CreateRoom();
        Assert.True(SignalRelayPolicy.CanRelay(room, clientA.Id, host.Id));
    }

    [Fact]
    public void ClientToClient_IsDropped()
    {
        var (room, _, clientA, clientB) = CreateRoom();
        Assert.False(SignalRelayPolicy.CanRelay(room, clientA.Id, clientB.Id));
        Assert.False(SignalRelayPolicy.CanRelay(room, clientB.Id, clientA.Id));
    }

    [Fact]
    public void SelfMessage_IsDropped()
    {
        var (room, host, _, _) = CreateRoom();
        Assert.False(SignalRelayPolicy.CanRelay(room, host.Id, host.Id));
    }

    [Fact]
    public void EmptyOrNullTarget_IsDropped()
    {
        var (room, host, _, _) = CreateRoom();
        Assert.False(SignalRelayPolicy.CanRelay(room, host.Id, null));
        Assert.False(SignalRelayPolicy.CanRelay(room, "", host.Id));
    }
}
