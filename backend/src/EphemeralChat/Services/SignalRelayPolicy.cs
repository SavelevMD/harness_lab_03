using EphemeralChat.Models;

namespace EphemeralChat.Services;

/// <summary>
/// Enforces the star topology: signaling may only travel between the HOST and
/// a single CLIENT. Client-to-client signaling is always dropped.
/// </summary>
public static class SignalRelayPolicy
{
    public static bool CanRelay(Room room, string fromId, string? toId)
    {
        if (room is null)
        {
            return false;
        }

        if (string.IsNullOrEmpty(fromId) || string.IsNullOrEmpty(toId))
        {
            return false;
        }

        if (string.Equals(fromId, toId, StringComparison.Ordinal))
        {
            return false;
        }

        bool fromIsHost = string.Equals(fromId, room.HostId, StringComparison.Ordinal);
        bool toIsHost = string.Equals(toId, room.HostId, StringComparison.Ordinal);

        // Exactly one endpoint must be the host (host <-> client).
        return fromIsHost != toIsHost;
    }
}
