using EphemeralChat.Services;

namespace EphemeralChat.Tests;

public class RoomCodeGeneratorTests
{
    [Fact]
    public void Generate_ReturnsSixCharacters()
    {
        var generator = new RoomCodeGenerator();
        for (int i = 0; i < 500; i++)
        {
            Assert.Equal(6, generator.Generate().Length);
        }
    }

    [Fact]
    public void Generate_OnlyUsesBase32Alphabet()
    {
        var generator = new RoomCodeGenerator();
        for (int i = 0; i < 2000; i++)
        {
            string code = generator.Generate();
            Assert.All(code, c => Assert.Contains(c, RoomCodeGenerator.Alphabet));
        }
    }

    [Fact]
    public void Generate_ProducesUniqueCodes()
    {
        var generator = new RoomCodeGenerator();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < 10000; i++)
        {
            string code = generator.Generate();
            Assert.True(seen.Add(code), $"Duplicate code generated: {code}");
        }
    }
}
