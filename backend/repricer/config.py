"""Загрузка параметров расчёта из YAML-конфига."""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

from repricer.core import Rules

KNOWN_KEYS = {"discount", "markdown_markup", "cost_markup", "rounding"}


def load_rules(path: Optional[Union[str, Path]] = None) -> Rules:
    """Прочитать config.yaml; без файла — дефолты. Неизвестные ключи — ошибка (защита от опечаток)."""
    if path is None:
        return Rules()

    import yaml

    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if raw is None:
        return Rules()
    if not isinstance(raw, dict):
        raise ValueError(f"Конфиг {path} должен быть YAML-словарём, получено: {type(raw).__name__}")

    unknown = set(raw) - KNOWN_KEYS
    if unknown:
        raise ValueError(f"Неизвестные ключи в {path}: {', '.join(sorted(unknown))}. Допустимые: {', '.join(sorted(KNOWN_KEYS))}")

    if "rounding" in raw:
        raw["rounding"] = str(raw["rounding"])
    return Rules(**raw)
