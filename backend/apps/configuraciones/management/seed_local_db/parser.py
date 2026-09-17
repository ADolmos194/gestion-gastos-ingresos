import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from django.core.management.base import CommandError

from apps.configuraciones.management.seed_local_db.config import ALL_SEED_CONFIGS


@dataclass(frozen=True)
class SeedFilePaths:
    """Resolved paths for each configured seed file."""

    seed_files: dict[str, Path]

    def path_for(self, name: str) -> Path:
        try:
            return self.seed_files[name]
        except KeyError as exc:
            raise CommandError(f'Unknown seed file name "{name}".') from exc


@dataclass(frozen=True)
class SeedPayload:
    """All the seed data loaded from the JSON files, keyed by table."""

    status_type_seed_data: list[dict]
    status_seed_data: list[dict]
    system_seed_data: list[dict]
    tipo_categoria_seed_data: list[dict]
    tipo_cuenta_seed_data: list[dict]
    event_seed_data: list[dict]
    action_seed_data: list[dict]
    permission_seed_data: list[dict]
    role_seed_data: list[dict]
    menu_seed_data: list[dict]
    role_menu_seed_data: list[dict]
    user_role_seed_data: list[dict]
    permission_role_seed_data: list[dict]


def build_seed_file_paths(options: Mapping[str, object]) -> SeedFilePaths:
    """Builds a SeedFilePaths instance from management command options,
    applying any --seed-name/--seed-file path overrides."""
    overrides = _build_seed_file_overrides(
        seed_names=_coerce_option_strings(options.get("seed_name"), option_name="seed_name"),
        seed_files=_coerce_option_strings(options.get("seed_file"), option_name="seed_file"),
    )

    return SeedFilePaths(
        seed_files={
            name: _resolve_path(overrides.get(name, config.default_path)) for name, config in ALL_SEED_CONFIGS.items()
        }
    )


def load_seed_payload(paths: SeedFilePaths) -> SeedPayload:
    """Loads and parses every configured seed JSON file into a SeedPayload."""
    data: dict[str, list[dict]] = {}
    for name, config in ALL_SEED_CONFIGS.items():
        data[config.payload_field] = _load_array_seed_data(paths.path_for(name), config.root_key, config.label)

    return SeedPayload(**data)


def uuid_from_value(value: str, field_name: str) -> uuid.UUID:
    try:
        return uuid.UUID(value.strip() if isinstance(value, str) else value)
    except (TypeError, ValueError, AttributeError) as exc:
        raise CommandError(f"Invalid UUID for {field_name}: {value}") from exc


def _resolve_path(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def _coerce_option_strings(value: object, option_name: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        values = []
        for item in value:
            if not isinstance(item, str):
                raise CommandError(f'Option "{option_name}" must contain only string values.')
            values.append(item)
        return values
    raise CommandError(f'Option "{option_name}" must be a string or a list of strings.')


def _build_seed_file_overrides(seed_names: Sequence[str], seed_files: Sequence[str]) -> dict[str, str]:
    if len(seed_names) != len(seed_files):
        raise CommandError('Seed overrides must pair each "--seed-name" with one "--seed-file".')

    overrides: dict[str, str] = {}
    for seed_name, seed_file in zip(seed_names, seed_files, strict=True):
        if seed_name not in ALL_SEED_CONFIGS:
            available_names = ", ".join(ALL_SEED_CONFIGS)
            raise CommandError(f'Unknown seed name "{seed_name}". Available names: {available_names}.')
        if seed_name in overrides:
            raise CommandError(f'Duplicate seed override for "{seed_name}".')
        overrides[seed_name] = seed_file

    return overrides


def _load_json(seed_file: Path, label: str) -> dict:
    try:
        with seed_file.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise CommandError(f"{label} file not found: {seed_file}") from exc
    except json.JSONDecodeError as exc:
        raise CommandError(f"Invalid JSON in {label} file {seed_file}: {exc}") from exc


def _load_array_seed_data(seed_file: Path, root_key: str, label: str) -> list[dict]:
    payload = _load_json(seed_file, label)
    rows = payload.get(root_key)
    if not isinstance(rows, list):
        raise CommandError(f'{label} file must contain a "{root_key}" array.')
    return rows
