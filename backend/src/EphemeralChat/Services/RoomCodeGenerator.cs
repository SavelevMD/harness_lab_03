namespace EphemeralChat.Services;

public interface IRoomCodeGenerator
{
    string Generate();
}

/// <summary>
/// Generates room codes: 6 characters drawn from the base32 alphabet
/// (32^6 ≈ 30 bits of entropy), collision-checked by the caller.
/// </summary>
public sealed class RoomCodeGenerator : IRoomCodeGenerator
{
    public const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    public const int CodeLength = 6;

    public string Generate()
    {
        Span<char> buffer = stackalloc char[CodeLength];
        for (int i = 0; i < CodeLength; i++)
        {
            buffer[i] = Alphabet[Random.Shared.Next(Alphabet.Length)];
        }

        return new string(buffer);
    }
}
