import pytest

from repricer.config import load_rules
from repricer.core import Rules


def test_defaults_without_file():
    assert load_rules(None) == Rules()


def test_load_yaml(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("discount: 0.05\nmarkdown_markup: 0.01\ncost_markup: 0.05\nrounding: '10'\n", encoding="utf-8")
    rules = load_rules(cfg)
    assert rules == Rules(discount=0.05, markdown_markup=0.01, cost_markup=0.05, rounding="10")


def test_partial_config_keeps_defaults(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("discount: 0.05\n", encoding="utf-8")
    rules = load_rules(cfg)
    assert rules.discount == 0.05
    assert rules.markdown_markup == 0.05  # дефолт


def test_unknown_key_rejected(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("discont: 0.05\n", encoding="utf-8")  # опечатка
    with pytest.raises(ValueError, match="discont"):
        load_rules(cfg)


def test_rounding_number_coerced(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("rounding: 10\n", encoding="utf-8")  # без кавычек — YAML даст int
    assert load_rules(cfg).rounding == "10"


def test_empty_config(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("", encoding="utf-8")
    assert load_rules(cfg) == Rules()
