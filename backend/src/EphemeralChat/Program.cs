using System.Text.Json;
using EphemeralChat.Contracts;
using EphemeralChat.Services;

var builder = WebApplication.CreateBuilder(args);

// Default to http://localhost:5080 unless ASPNETCORE_URLS is explicitly set.
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://localhost:5080");
}

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddSingleton<IRoomCodeGenerator, RoomCodeGenerator>();
builder.Services.AddSingleton<IRoomRegistry, RoomRegistry>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<IConnectionManager>(sp => sp.GetRequiredService<ConnectionManager>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<ConnectionManager>());

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();

app.UseCors();
app.UseWebSockets();

app.MapPost("/api/rooms", (CreateRoomRequest request, IRoomRegistry registry) =>
{
    var result = registry.CreateRoom(request.Nickname ?? string.Empty);
    if (result.Status == CreateStatus.InvalidNickname)
    {
        return Results.Json(
            new ErrorResponse(ErrorCodes.InvalidNickname, ErrorMessages.InvalidNickname),
            statusCode: StatusCodes.Status400BadRequest);
    }

    var room = result.Room!;
    var host = room.Host!;
    return Results.Ok(new CreateRoomResponse(room.Code, host.Id, host.Token, true));
});

app.MapPost("/api/rooms/{code}/join", (string code, CreateRoomRequest request, IRoomRegistry registry) =>
{
    var result = registry.Join(code, request.Nickname ?? string.Empty);
    return result.Status switch
    {
        JoinStatus.InvalidNickname => Results.Json(
            new ErrorResponse(ErrorCodes.InvalidNickname, ErrorMessages.InvalidNickname),
            statusCode: StatusCodes.Status400BadRequest),
        JoinStatus.RoomNotFound => Results.Json(
            new ErrorResponse(ErrorCodes.RoomNotFound, ErrorMessages.RoomNotFound),
            statusCode: StatusCodes.Status404NotFound),
        JoinStatus.RoomFull => Results.Json(
            new ErrorResponse(ErrorCodes.RoomFull, ErrorMessages.RoomFull),
            statusCode: StatusCodes.Status409Conflict),
        _ => Results.Ok(new JoinRoomResponse(
            result.Room!.Code,
            result.Participant!.Id,
            result.Participant.Token,
            false,
            result.Room.HostId)),
    };
});

app.MapGet("/api/rooms/{code}", (string code, IRoomRegistry registry) =>
{
    var room = registry.Probe(code);
    if (room is null)
    {
        return Results.Json(
            new ErrorResponse(ErrorCodes.RoomNotFound, ErrorMessages.RoomNotFound),
            statusCode: StatusCodes.Status404NotFound);
    }

    return Results.Ok(new RoomProbeResponse(room.Code, room.ParticipantCount, true));
});

app.MapGet("/ws", async (HttpContext context, IConnectionManager manager) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    await manager.HandleAsync(context);
});

app.Run();

public partial class Program { }
