from rest_framework import serializers

from .models import Moneda


class MonedaSerializer(serializers.ModelSerializer):
    status = serializers.CharField(source="key_status.name", read_only=True)
    # El frontend compara esto contra VITE_STATUS_ACTIVATE (ver frontend/.env) para saber
    # si pintar la celda de Estado en verde, en vez de comparar por el nombre.
    status_id = serializers.UUIDField(source="key_status_id", read_only=True)

    class Meta:
        model = Moneda
        fields = [
            "id",
            "name",
            "code",
            "symbol",
            "description",
            "status",
            "status_id",
            "creation_date",
            "update_date",
        ]
        read_only_fields = ["id", "status", "status_id", "creation_date", "update_date"]

    def validate_code(self, value: str) -> str:
        # El código de moneda es su identidad real (ver _find_blocking_duplicate en
        # views.py, que bloquea duplicados por code, no por name) — normalizado acá para
        # que "usd", "Usd" y "USD" sean el mismo código sin importar cómo se haya tipeado.
        return value.strip().upper()
