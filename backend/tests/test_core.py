from decimal import Decimal

import pytest

from repricer.core import Rules, Status, compute_price, parse_number, round_price

RULES = Rules()  # discount 4%, markdown_markup 5%, cost_markup 4%, округление до рубля


# --- Правило 1: база Min − 4% ---

def test_base_rule_ok():
    # Min=1000, себестоимость 500 → 1000*0.96 = 960
    r = compute_price(500, 1000, None, RULES)
    assert r.new_price == Decimal("960")
    assert r.status == Status.OK
    assert not r.for_review


def test_base_rule_rounding():
    # Min=1826 (реальная строка) → 1826*0.96 = 1752.96 → 1753
    r = compute_price(978, 1826, None, RULES)
    assert r.new_price == Decimal("1753")
    assert r.status == Status.OK


# --- Правило 2а: база < себестоимости, есть уценка ---

def test_markdown_rule():
    # Min=1000 → база 960 < себестоимость 2000; уценка 500 → 500*1.05 = 525
    r = compute_price(2000, 1000, 500, RULES)
    assert r.new_price == Decimal("525")
    assert r.status == "УЦЕНКА+5%"
    assert not r.for_review


def test_markdown_rule_custom_markup():
    rules = Rules(markdown_markup=0.01)
    r = compute_price(2000, 1000, 500, rules)
    assert r.new_price == Decimal("505")
    assert r.status == "УЦЕНКА+1%"


# --- Правило 2б: база < себестоимости, уценки нет ---

def test_cost_rule():
    # Min=1000 → база 960 < себестоимость 2000, уценки нет → 2000*1.04 = 2080 > Min → КОНФЛИКТ
    r = compute_price(2000, 1000, None, RULES)
    assert r.new_price == Decimal("2080")
    assert r.status == Status.CONFLICT
    assert r.for_review


def test_cost_rule_no_conflict():
    # Min=1000 → база 960 < себестоимость 950? нет: 960 >= 950 → OK.
    # Берём себестоимость 970: база 960 < 970 → 970*1.04 = 1008.8 → 1009 > 1000 → КОНФЛИКТ.
    # Чтобы СЕБЕСТ не конфликтовал, итог должен быть <= Min: себестоимость 961,
    # 961*1.04 = 999.44 → 999 <= 1000 → статус СЕБЕСТ+4%
    r = compute_price(961, 1000, None, RULES)
    assert r.new_price == Decimal("999")
    assert r.status == "СЕБЕСТ+4%"
    assert not r.for_review


# --- Правило 3: жёсткий пол по уценке ---

def test_floor_markdown_above_base():
    # база 960 >= себестоимость 100 → OK-ветка, но уценка 980 выше базы → пол: 980
    r = compute_price(100, 1000, 980, RULES)
    assert r.new_price == Decimal("980")
    assert r.status == Status.MARKDOWN_FLOOR
    assert not r.for_review


def test_floor_markdown_above_min_conflict():
    # уценка 1200 > Min 1000: пол поднимает цену выше рынка → КОНФЛИКТ
    r = compute_price(100, 1000, 1200, RULES)
    assert r.new_price == Decimal("1200")
    assert r.status == Status.CONFLICT
    assert r.for_review


def test_markdown_above_cost():
    # уценка 3000 > себестоимости 2000: база 960 < 2000 → уценка*1.05 = 3150 > Min → КОНФЛИКТ
    r = compute_price(2000, 1000, 3000, RULES)
    assert r.new_price == Decimal("3150")
    assert r.status == Status.CONFLICT


# --- Правило 4: конфликт с рынком ---

def test_conflict_price_still_written():
    r = compute_price(5000, 1000, None, RULES)
    assert r.new_price == Decimal("5200")
    assert r.for_review


# --- НЕТ MIN ЦЕНЫ / ошибки данных ---

@pytest.mark.parametrize("min_price", [None, 0, "", -5, "#N/A", "abc"])
def test_no_min_price(min_price):
    r = compute_price(100, min_price, None, RULES)
    assert r.new_price is None
    assert r.status == Status.NO_MIN
    assert r.for_review


@pytest.mark.parametrize("cost", [None, "", -1, "мусор"])
def test_bad_cost(cost):
    r = compute_price(cost, 1000, None, RULES)
    assert r.new_price is None
    assert r.status == Status.BAD_DATA
    assert r.for_review


def test_zero_cost_is_valid():
    # себестоимость 0 — допустима: база 960 >= 0 → OK
    r = compute_price(0, 1000, None, RULES)
    assert r.new_price == Decimal("960")
    assert r.status == Status.OK


def test_markdown_excel_error_treated_as_absent():
    # '#N/A' в уценке (битый VLOOKUP) → ветка СЕБЕСТ
    # база 520*0.96 = 499.2 < 500; итог 500*1.04 = 520 <= Min → без конфликта
    r = compute_price(500, 520, "#N/A", RULES)
    assert r.status == "СЕБЕСТ+4%"
    assert r.new_price == Decimal("520")


def test_markdown_zero_treated_as_absent():
    r = compute_price(500, 520, 0, RULES)
    assert r.status == "СЕБЕСТ+4%"


# --- Округление ---

def test_rounding_kopecks():
    rules = Rules(rounding="0.01")
    r = compute_price(500, 1000.55, None, rules)
    assert r.new_price == Decimal("960.53")  # 1000.55*0.96 = 960.528


def test_rounding_tens():
    rules = Rules(rounding="10")
    r = compute_price(500, 1004, None, rules)
    assert r.new_price == Decimal("960")  # 964.

def test_round_half_up():
    assert round_price(Decimal("2.5"), "1") == Decimal("3")  # не банковское округление
    assert round_price(Decimal("745"), "10") == Decimal("750")


def test_no_float_tails():
    # 744.9599999... из реального файла → ровно 745
    r = compute_price(100, Decimal("776"), None, RULES)
    assert r.new_price == Decimal("745")
    assert str(r.new_price) == "745"


# --- parse_number ---

@pytest.mark.parametrize("raw,expected", [
    (100, Decimal("100")),
    (99.5, Decimal("99.5")),
    ("1 234,56", Decimal("1234.56")),
    ("  42 ", Decimal("42")),
    (None, None),
    ("", None),
    ("#N/A", None),
    ("#REF!", None),
    (True, None),
    ("text", None),
])
def test_parse_number(raw, expected):
    assert parse_number(raw) == expected


# --- Валидация Rules ---

def test_rules_validation():
    with pytest.raises(ValueError):
        Rules(discount=1.5)
    with pytest.raises(ValueError):
        Rules(rounding="0.5")
