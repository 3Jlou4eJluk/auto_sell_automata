"""CLI: python reprice.py input.xlsx [-o output.xlsx] [-c config.yaml]"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from repricer.config import load_rules
from repricer.core import Status
from repricer.excel_io import REVIEW_SHEET, reprice_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reprice",
        description="Пересчёт «Новой цены» в файле проценки автозапчастей",
    )
    parser.add_argument("input", help="входной файл проценки (.xlsx)")
    parser.add_argument("-o", "--output", help="выходной файл (по умолчанию <вход>_repriced.xlsx)")
    parser.add_argument("-c", "--config", help="YAML-конфиг с параметрами расчёта (без него — дефолты)")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"Ошибка: файл не найден: {input_path}", file=sys.stderr)
        return 1

    config_path = args.config
    if config_path and not Path(config_path).is_file():
        print(f"Ошибка: конфиг не найден: {config_path}", file=sys.stderr)
        return 1

    try:
        rules = load_rules(config_path)
    except Exception as exc:
        print(f"Ошибка в конфиге: {exc}", file=sys.stderr)
        return 1

    output_path = Path(args.output) if args.output else input_path.with_name(input_path.stem + "_repriced.xlsx")

    try:
        report = reprice_file(input_path, output_path, rules)
    except ValueError as exc:
        print(f"Ошибка входных данных: {exc}", file=sys.stderr)
        return 1

    print(f"Лист: {report.sheet}")
    for warning in report.warnings:
        print(f"  ⚠ {warning}")
    print(f"Параметры: скидка от Min {rules.discount:.0%}, уценка +{rules.markdown_markup:.0%}, "
          f"себестоимость +{rules.cost_markup:.0%}, округление до {rules.rounding} руб.")
    print(f"Всего строк: {report.total}")
    for status, count in sorted(report.by_status.items(), key=lambda kv: -kv[1]):
        print(f"  {status}: {count}")
    print(f"На разбор (лист «{REVIEW_SHEET}»): {report.review_count}")
    print(f"Результат: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
