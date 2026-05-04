from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ConversionError(Exception):
    code: str
    message: str
    status_code: int = 500
    details: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(self.message)

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "code": self.code,
            "message": self.message,
        }
        if self.details:
            payload["details"] = self.details
        return payload

    def __reduce__(self):
        return (
            self.__class__,
            (self.code, self.message, self.status_code, self.details),
        )
