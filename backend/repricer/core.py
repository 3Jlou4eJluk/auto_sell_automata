"""Ядро расчёта «Новой цены». Чистые функции без I/O — переиспользуются CLI и (позже) API.

Бизнес-правила:
1. База: Новая = Min × (1 − discount).
2. Если база < себестоимости:
   а) есть уценка → Новая = Уценка × (1 + markdown_markup);
   б) уценки нет → Новая = Себестоимость × (1 + cost_markup).
3. Жёсткий пол: Новая не ниже уценки (если задана).
4. Если итог > Min — позиция неконкурентна: цена проставляется, статус КОНФЛИКТ,
   решение принимает человек (лист «На разбор»).
5. Округление по параметру rounding.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Union

Number = Union[int, float, Decimal]

# Строковые значения ошибок Excel, которые встречаются в кэше формул (VLOOKUP на внешний файл)
EXCEL_ERRORS = {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NULL!", "#NUM!"}


class Status:
    OK = "OK"
    CONFLICT = "КОНФЛИКТ"
    NO_MIN = "НЕТ MIN ЦЕНЫ"
    BAD_DATA = "ОШИБКА ДАННЫХ"
    MARKDOWN_FLOOR = "ПОЛ УЦЕНКИ"

    @staticmethod
    def markdown(markup: float) -> str:
        return f"УЦЕНКА+{_pct(markup)}%"

    @staticmethod
    def cost(markup: float) -> str:
        return f"СЕБЕСТ+{_pct(markup)}%"


def _pct(fraction: float) -> str:
    return f"{fraction * 100:g}"


@dataclass(frozen=True)
class Rules:
    discount: float = 0.04          # скидка от Min цены
    markdown_markup: float = 0.05   # наценка на уценку (ТЗ: +1%, факт. файл: +5%)
    cost_markup: float = 0.04       # наценка на себестоимость
    rounding: str = "1"             # "1" | "0.01" | "10"

    def __post_init__(self) -> None:
        for name in ("discount", "markdown_markup", "cost_markup"):
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or not (0 <= value < 1):
                raise ValueError(f"{name} должен быть долей в диапазоне [0, 1), получено: {value!r}")
        if str(self.rounding) not in ("1", "0.01", "10"):
            raise ValueError(f'rounding должен быть "1", "0.01" или "10", получено: {self.rounding!r}')


@dataclass(frozen=True)
class PriceResult:
    new_price: Optional[Decimal]  # None — цену не меняем (нет Min цены / ошибка данных)
    status: str
    for_review: bool              # позиция уходит на лист «На разбор»


def parse_number(value: object) -> Optional[Decimal]:
    """Ячейка Excel → число. Строки ошибок Excel, пустые и нечисловые значения → None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))
    if isinstance(value, str):
        text = value.strip()
        if not text or text in EXCEL_ERRORS:
            return None
        try:
            return Decimal(text.replace("\xa0", "").replace(" ", "").replace(",", "."))
        except ArithmeticError:
            return None
    return None


def round_price(value: Decimal, rounding: str) -> Decimal:
    step = {"1": Decimal("1"), "0.01": Decimal("0.01"), "10": Decimal("10")}[str(rounding)]
    return (value / step).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * step


def compute_price(
    cost: object,
    min_price: object,
    markdown_price: object,
    rules: Rules,
) -> PriceResult:
    """Рассчитать новую цену для одной строки прайса.

    Принимает сырые значения ячеек (могут быть None, строки, ошибки Excel).
    """
    cost_v = parse_number(cost)
    min_v = parse_number(min_price)
    markdown_v = parse_number(markdown_price)
    if markdown_v is not None and markdown_v <= 0:
        markdown_v = None  # нулевая/отрицательная уценка — считаем, что уценки нет

    if cost_v is None or cost_v < 0:
        return PriceResult(None, Status.BAD_DATA, for_review=True)
    if min_v is None or min_v <= 0:
        return PriceResult(None, Status.NO_MIN, for_review=True)

    # Правило 1: база — Min минус скидка
    base = min_v * (Decimal("1") - Decimal(str(rules.discount)))

    if base < cost_v:
        # Правило 2: база ниже себестоимости
        if markdown_v is not None:
            new = markdown_v * (Decimal("1") + Decimal(str(rules.markdown_markup)))
            status = Status.markdown(rules.markdown_markup)
        else:
            new = cost_v * (Decimal("1") + Decimal(str(rules.cost_markup)))
            status = Status.cost(rules.cost_markup)
    else:
        new = base
        status = Status.OK

    # Правило 3: жёсткий пол — не ниже согласованной уценки
    if markdown_v is not None and new < markdown_v:
        new = markdown_v
        status = Status.MARKDOWN_FLOOR

    # Правило 5: округление
    new = round_price(new, rules.rounding)

    # Правило 4: итог выше рыночного минимума — конфликт, решает человек
    if new > min_v:
        return PriceResult(new, Status.CONFLICT, for_review=True)

    return PriceResult(new, status, for_review=False)
