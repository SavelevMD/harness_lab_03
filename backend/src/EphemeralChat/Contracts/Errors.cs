namespace EphemeralChat.Contracts;

public static class ErrorCodes
{
    public const string InvalidNickname = "invalid_nickname";
    public const string RoomNotFound = "room_not_found";
    public const string RoomFull = "room_full";
    public const string InvalidToken = "invalid_token";
}

public static class ErrorMessages
{
    public const string InvalidNickname = "Никнейм обязателен (до 20 символов)";
    public const string RoomNotFound = "Комната не существует или хост офлайн";
    public const string RoomFull = "Комната заполнена (макс. 20)";
    public const string HostLeft = "Хост покинул чат. Комната закрыта.";
    public const string InvalidToken = "Недействительный токен или участник";
    public const string AlreadyConnected = "Участник уже подключен";
}
