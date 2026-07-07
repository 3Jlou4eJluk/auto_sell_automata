"""FastAPI-обёртка над движком репрайсинга."""
from __future__ import annotations

import base64
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Optional
from zipfile import BadZipFile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openpyxl.utils.exceptions import InvalidFileException

from repricer.core import EXCEL_ERRORS, Rules, parse_number
from repricer.excel_io import RowOutcome, reprice_file

app = FastAPI(title="Repricer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    """Проверка доступности API."""
    return {"status": "ok"}


@app.post("/api/reprice")
async def reprice(
    file: UploadFile = File(...),
    discount: Optional[float] = Form(None),
    markdown_markup: Optional[float] = Form(None),
    cost_markup: Optional[float] = Form(None),
    rounding: Optional[str] = Form(None),
) -> dict:
    """Пересчитать цены во входном xlsx и вернуть отчёт с результирующим файлом."""
    filename = file.filename or ""
    if Path(filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=400, detail="Поддерживаются только .xlsx файлы")

    try:
        rules = _make_rules(discount, markdown_markup, cost_markup, rounding)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    stem = Path(filename).stem
    output_filename = f"{stem}_repriced.xlsx"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        input_path = tmp_dir / "input.xlsx"
        output_path = tmp_dir / output_filename
        try:
            with input_path.open("wb") as dst:
                while chunk := await file.read(1024 * 1024):
                    dst.write(chunk)

            report = reprice_file(input_path, output_path, rules)
        except (ValueError, BadZipFile, InvalidFileException, KeyError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        output_b64 = base64.b64encode(output_path.read_bytes()).decode("ascii")

    return {
        "summary": {
            "sheet": report.sheet,
            "total": report.total,
            "by_status": report.by_status,
            "review_count": report.review_count,
            "warnings": report.warnings,
            "params": {
                "discount": rules.discount,
                "markdown_markup": rules.markdown_markup,
                "cost_markup": rules.cost_markup,
                "rounding": str(rules.rounding),
            },
        },
        "rows": [_row_to_api(item) for item in report.all_rows],
        "output_filename": output_filename,
        "output_xlsx_base64": output_b64,
    }


def _make_rules(
    discount: Optional[float],
    markdown_markup: Optional[float],
    cost_markup: Optional[float],
    rounding: Optional[str],
) -> Rules:
    defaults = Rules()
    return Rules(
        discount=defaults.discount if discount is None else discount,
        markdown_markup=defaults.markdown_markup if markdown_markup is None else markdown_markup,
        cost_markup=defaults.cost_markup if cost_markup is None else cost_markup,
        rounding=defaults.rounding if rounding is None else rounding,
    )


def _row_to_api(item: RowOutcome) -> dict:
    v, r = item.values, item.result
    new_price = _number(r.new_price) if r.new_price is not None else None
    cost = parse_number(v["cost"])
    delta = _number(r.new_price - cost) if r.new_price is not None and cost is not None else None
    return {
        "row": item.row,
        "num": _value(v["num"]),
        "article": _value(v["article"]),
        "brand": _value(v["brand"]),
        "name": _value(v["name"]),
        "qty": _value(v["qty"]),
        "cost": _value(v["cost"]),
        "min_price": _value(v["min_price"]),
        "supplier": _value(v["supplier"]),
        "markdown": _value(v["markdown"], null_excel_error=True),
        "new_price": new_price,
        "delta": delta,
        "status": r.status,
        "for_review": r.for_review,
        "warehouse": _value(v["warehouse"]),
    }


def _value(value: object, null_excel_error: bool = False) -> object:
    if null_excel_error and isinstance(value, str) and value.strip() in EXCEL_ERRORS:
        return None
    if isinstance(value, Decimal):
        return _number(value)
    return value


def _number(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)
