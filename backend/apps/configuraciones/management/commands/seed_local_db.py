from django.core.management.base import BaseCommand

from apps.configuraciones.management.seed_local_db.config import get_available_seed_config_names
from apps.configuraciones.management.seed_local_db.parser import build_seed_file_paths, load_seed_payload
from apps.configuraciones.management.seed_local_db.service import SeedLocalDbService


class Command(BaseCommand):
    help = "Carga los datos de referencia locales para Gastos e Ingresos desde archivos JSON."

    def add_arguments(self, parser):
        available_seed_names = get_available_seed_config_names()
        available_names = ", ".join(available_seed_names)
        parser.add_argument(
            "--seed-file",
            action="append",
            metavar="PATH",
            help="Ruta alternativa para el --seed-name correspondiente. Repite el par para sobreescribir varios seeds.",
        )
        parser.add_argument(
            "--seed-name",
            action="append",
            choices=available_seed_names,
            metavar="NAME",
            help=f"Nombre del seed a sobreescribir junto con --seed-file. Disponibles: {available_names}.",
        )

    def handle(self, *args, **options):
        seed_paths = build_seed_file_paths(options)
        seed_payload = load_seed_payload(seed_paths)
        result = SeedLocalDbService().seed(seed_payload)

        self.stdout.write(self.style.SUCCESS("Seed de la base de datos local completado."))
        for seed_name, path in seed_paths.seed_files.items():
            self.stdout.write(f"{seed_name}={path}")
        self.stdout.write(f"system_id={result.system_id}")
        for email in result.skipped_user_roles:
            self.stdout.write(
                self.style.WARNING(
                    f"user_roles: no se encontró un usuario con email={email}, se omitió la asignación de rol."
                )
            )
