using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace EphemeralChat.Tests;

/// <summary>
/// Verifies the exact REST contract (status codes, field names, error bodies).
/// These tests do not require a live host WebSocket.
/// </summary>
public class ApiContractTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public ApiContractTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task CreateRoom_ReturnsExpectedContract()
    {
        var response = await _client.PostAsJsonAsync("/api/rooms", new { nickname = "Alice" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        Assert.Equal(6, root.GetProperty("code").GetString()!.Length);
        Assert.False(string.IsNullOrEmpty(root.GetProperty("participantId").GetString()));
        Assert.False(string.IsNullOrEmpty(root.GetProperty("token").GetString()));
        Assert.True(root.GetProperty("isHost").GetBoolean());

        Assert.Equal(new[] { "code", "participantId", "token", "isHost" }, PropertyNames(root));
    }

    [Fact]
    public async Task CreateRoom_InvalidNickname_Returns400WithExactBody()
    {
        var response = await _client.PostAsJsonAsync("/api/rooms", new { nickname = string.Empty });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        Assert.Equal("invalid_nickname", root.GetProperty("error").GetString());
        Assert.Equal("Никнейм обязателен (до 20 символов)", root.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Join_UnknownRoom_Returns404WithExactBody()
    {
        var response = await _client.PostAsJsonAsync("/api/rooms/ZZZZZZ/join", new { nickname = "Client" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        Assert.Equal("room_not_found", root.GetProperty("error").GetString());
        Assert.Equal("Комната не существует или хост офлайн", root.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Join_InvalidNickname_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/rooms/ZZZZZZ/join", new { nickname = new string('x', 21) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("invalid_nickname", json.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Probe_UnknownRoom_Returns404WithExactBody()
    {
        var response = await _client.GetAsync("/api/rooms/ZZZZZZ");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        Assert.Equal("room_not_found", root.GetProperty("error").GetString());
        Assert.Equal("Комната не существует или хост офлайн", root.GetProperty("message").GetString());
    }

    private static string[] PropertyNames(JsonElement element)
        => element.EnumerateObject().Select(p => p.Name).ToArray();
}
