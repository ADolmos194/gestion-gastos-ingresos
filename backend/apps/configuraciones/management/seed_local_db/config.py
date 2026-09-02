from dataclasses import dataclass
from pathlib import Path

COMMANDS_DIR = Path(__file__).resolve().parent.parent / "commands"


@dataclass(frozen=True)
class SeedConfig:
    """Describes one seed JSON file: where it lives, its root key, and which
    SeedPayload field its rows are collected into."""

    name: str
    default_path: Path
    root_key: str
    payload_field: str
    label: str


ALL_SEED_CONFIGS: dict[str, SeedConfig] = {
    config.name: config
    for config in (
        SeedConfig(
            "status_types",
            COMMANDS_DIR / "seed_status_types.json",
            "cfg_status_types",
            "status_type_seed_data",
            "Status types seed",
        ),
        SeedConfig(
            "statuses",
            COMMANDS_DIR / "seed_statuses.json",
            "cfg_status",
            "status_seed_data",
            "Statuses seed",
        ),
        SeedConfig(
            "system",
            COMMANDS_DIR / "seed_system.json",
            "cfg_system",
            "system_seed_data",
            "System seed",
        ),
        SeedConfig(
            "tipo_categorias",
            COMMANDS_DIR / "seed_tipo_categorias.json",
            "cfg_tipo_categorias",
            "tipo_categoria_seed_data",
            "Tipo categoria seed",
        ),
        SeedConfig(
            "events",
            COMMANDS_DIR / "seed_events.json",
            "sec_events",
            "event_seed_data",
            "Events seed",
        ),
        SeedConfig(
            "actions",
            COMMANDS_DIR / "seed_actions.json",
            "sec_actions",
            "action_seed_data",
            "Actions seed",
        ),
        SeedConfig(
            "permissions",
            COMMANDS_DIR / "seed_permissions.json",
            "sec_permissions",
            "permission_seed_data",
            "Permissions seed",
        ),
        SeedConfig(
            "roles",
            COMMANDS_DIR / "seed_roles.json",
            "sec_roles",
            "role_seed_data",
            "Roles seed",
        ),
        SeedConfig(
            "menu",
            COMMANDS_DIR / "seed_menu.json",
            "sec_menu",
            "menu_seed_data",
            "Menu seed",
        ),
        SeedConfig(
            "role_menu",
            COMMANDS_DIR / "seed_role_menu.json",
            "sec_role_menu",
            "role_menu_seed_data",
            "Role-menu seed",
        ),
        SeedConfig(
            "user_roles",
            COMMANDS_DIR / "seed_user_roles.json",
            "sec_user_roles",
            "user_role_seed_data",
            "User roles seed",
        ),
        SeedConfig(
            "permission_role",
            COMMANDS_DIR / "seed_permission_role.json",
            "sec_permission_role",
            "permission_role_seed_data",
            "Permission-role seed",
        ),
    )
}


def get_available_seed_config_names() -> tuple[str, ...]:
    return tuple(ALL_SEED_CONFIGS)
