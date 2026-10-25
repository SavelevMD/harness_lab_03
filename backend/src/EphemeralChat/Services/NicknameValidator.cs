namespace EphemeralChat.Services;

/// <summary>
/// Validates self-assigned nicknames: required, up to 20 characters.
/// </summary>
public static class NicknameValidator
{
    public const int MaxLength = 20;

    public static bool IsValid(string? nickname)
    {
        if (string.IsNullOrWhiteSpace(nickname))
        {
            return false;
        }

        int length = nickname.Trim().Length;
        return length >= 1 && length <= MaxLength;
    }

    public static string Normalize(string nickname) => nickname.Trim();
}
