using EphemeralChat.Services;

namespace EphemeralChat.Tests;

public class NicknameValidatorTests
{
    [Theory]
    [InlineData("A", true)]
    [InlineData("Alice", true)]
    [InlineData("12345678901234567890", true)]   // exactly 20 chars
    [InlineData("123456789012345678901", false)] // 21 chars
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData(null, false)]
    public void IsValid_ReturnsExpected(string? nickname, bool expected)
    {
        Assert.Equal(expected, NicknameValidator.IsValid(nickname));
    }

    [Fact]
    public void Normalize_TrimsSurroundingWhitespace()
    {
        Assert.Equal("Alice", NicknameValidator.Normalize("  Alice  "));
    }
}
