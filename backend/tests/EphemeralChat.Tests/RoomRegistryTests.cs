using EphemeralChat.Contracts;
using EphemeralChat.Services;

namespace EphemeralChat.Tests;

public class RoomRegistryTests
{
    private static RoomRegistry CreateRegistry(IRoomCodeGenerator? codeGenerator = null)
        => new(codeGenerator ?? new RoomCodeGenerator());

    private sealed class SequenceCodeGenerator : IRoomCodeGenerator
    {
        private readonly Queue<string> _queue;

        public SequenceCodeGenerator(params string[] codes) => _queue = new Queue<string>(codes);

        public string Generate() => _queue.Count > 0
            ? _queue.Dequeue()
            : Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
    }

    // ---- code generation & room creation ----

    [Fact]
    public void CreateRoom_ReturnsHostWithSixCharCode()
    {
        var registry = CreateRegistry();
        var result = registry.CreateRoom("Alice");

        Assert.Equal(CreateStatus.Success, result.Status);
        Assert.NotNull(result.Room);
        Assert.Equal(6, result.Room!.Code.Length);

        var host = result.Room.Host;
        Assert.NotNull(host);
        Assert.True(host!.IsHost);
        Assert.Equal("Alice", host.Nickname);
        Assert.False(string.IsNullOrEmpty(host.Token));
        Assert.False(string.IsNullOrEmpty(host.Id));
    }

    [Fact]
    public void CreateRoom_InvalidNickname_ReturnsError()
    {
        var registry = CreateRegistry();
        Assert.Equal(CreateStatus.InvalidNickname, registry.CreateRoom(string.Empty).Status);
        Assert.Equal(CreateStatus.InvalidNickname, registry.CreateRoom("   ").Status);
        Assert.Equal(CreateStatus.InvalidNickname, registry.CreateRoom(new string('x', 21)).Status);
    }

    [Fact]
    public void CreateRoom_RetriesOnCodeCollision()
    {
        var generator = new SequenceCodeGenerator("AAAAAA", "AAAAAA", "BBBBBB");
        var registry = CreateRegistry(generator);

        var first = registry.CreateRoom("A");
        var second = registry.CreateRoom("B");

        Assert.Equal("AAAAAA", first.Room!.Code);
        Assert.Equal("BBBBBB", second.Room!.Code);
    }

    // ---- create -> join flow ----

    [Fact]
    public void CreateThenJoin_ReturnsClientWithHostId()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        registry.SetHostConnected(created.Room!, true);

        var join = registry.Join(created.Room!.Code, "Client");

        Assert.Equal(JoinStatus.Success, join.Status);
        Assert.NotNull(join.Participant);
        Assert.NotNull(join.Room);
        Assert.False(join.Participant!.IsHost);
        Assert.Equal("Client", join.Participant.Nickname);
        Assert.Equal(created.Room.Host!.Id, join.Room!.HostId);
        Assert.Equal(created.Room.Code, join.Room.Code);
    }

    [Fact]
    public void Join_CaseInsensitiveCode_Works()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        registry.SetHostConnected(created.Room!, true);

        var join = registry.Join(created.Room!.Code.ToLowerInvariant(), "Client");

        Assert.Equal(JoinStatus.Success, join.Status);
    }

    [Fact]
    public void Join_UnknownRoom_ReturnsRoomNotFound()
    {
        var registry = CreateRegistry();
        var join = registry.Join("ZZZZZZ", "Client");
        Assert.Equal(JoinStatus.RoomNotFound, join.Status);
    }

    [Fact]
    public void Join_HostNotConnected_ReturnsRoomNotFound()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        // host never connects its socket
        var join = registry.Join(created.Room!.Code, "Client");
        Assert.Equal(JoinStatus.RoomNotFound, join.Status);
    }

    [Fact]
    public void Join_InvalidNickname_ReturnsError()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        registry.SetHostConnected(created.Room!, true);

        Assert.Equal(JoinStatus.InvalidNickname, registry.Join(created.Room!.Code, string.Empty).Status);
        Assert.Equal(JoinStatus.InvalidNickname, registry.Join(created.Room.Code, new string('x', 21)).Status);
    }

    // ---- 20 participant limit ----

    [Fact]
    public void Join_EnforcesTwentyParticipantLimit()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        registry.SetHostConnected(created.Room!, true);

        // host (1) + 19 clients = 20
        for (int i = 0; i < 19; i++)
        {
            Assert.Equal(JoinStatus.Success, registry.Join(created.Room!.Code, $"Client{i}").Status);
        }

        Assert.Equal(20, created.Room!.ParticipantCount);

        // 21st participant must be rejected
        var twentyFirst = registry.Join(created.Room.Code, "Client20");
        Assert.Equal(JoinStatus.RoomFull, twentyFirst.Status);
        Assert.Equal(20, created.Room.ParticipantCount);
    }

    // ---- host left ----

    [Fact]
    public void HostLeft_MarksRoomDead_ReturnsClients_AndBlocksFutureJoins()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        registry.SetHostConnected(created.Room!, true);
        registry.Join(created.Room!.Code, "Client1");
        registry.Join(created.Room.Code, "Client2");

        var clients = registry.HandleHostLeft(created.Room);

        Assert.Equal(2, clients.Count);
        Assert.True(clients.All(c => !c.IsHost));
        Assert.True(created.Room.IsDead);
        Assert.False(created.Room.HostConnected);

        // room becomes unjoinable
        Assert.Equal(JoinStatus.RoomNotFound, registry.Join(created.Room.Code, "Client3").Status);
        Assert.Null(registry.Probe(created.Room.Code));
    }

    // ---- probe ----

    [Fact]
    public void Probe_ReturnsRoomWithCount_WhenAlive()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        registry.SetHostConnected(created.Room!, true);
        registry.Join(created.Room!.Code, "Client1");

        var room = registry.Probe(created.Room.Code);

        Assert.NotNull(room);
        Assert.Equal(2, room!.ParticipantCount);
        Assert.True(room.HostConnected);
    }

    [Fact]
    public void Probe_ReturnsNull_WhenHostOfflineOrDead()
    {
        var registry = CreateRegistry();
        var created = registry.CreateRoom("Host");
        Assert.Null(registry.Probe(created.Room!.Code)); // host offline

        registry.SetHostConnected(created.Room, true);
        Assert.NotNull(registry.Probe(created.Room.Code));

        registry.HandleHostLeft(created.Room);
        Assert.Null(registry.Probe(created.Room.Code)); // dead
    }
}
