from rest_framework import serializers

from .models import Categoria, TipoCategoria


class TipoCategoriaSerializer(serializers.ModelSerializer):
    # Mismo criterio que TipoCuentaSerializer (ver cuenta/serializers.py): status/status_id
    # solo los usa bulk_save_tipos_categoria, list_tipos_categoria (el dropdown) sigue
    # pidiendo nada más que id/name en la práctica.
    status = serializers.CharField(source="key_status.name", read_only=True)
    status_id = serializers.UUIDField(source="key_status_id", read_only=True)

    class Meta:
        model = TipoCategoria
        fields = ["id", "name", "description", "status", "status_id", "creation_date", "update_date"]
        read_only_fields = ["id", "status", "status_id", "creation_date", "update_date"]


class CategoriaSerializer(serializers.ModelSerializer):
    tipo_nombre = serializers.CharField(source="key_tipo.name", read_only=True)
    status = serializers.CharField(source="key_status.name", read_only=True)
    # El frontend compara esto contra VITE_STATUS_ACTIVATE (ver frontend/.env) para saber
    # si pintar la celda de Estado en verde, en vez de comparar por el nombre.
    status_id = serializers.UUIDField(source="key_status_id", read_only=True)

    class Meta:
        model = Categoria
        fields = [
            "id",
            "name",
            "key_tipo",
            "tipo_nombre",
            "description",
            "color",
            "icon",
            "status",
            "status_id",
            "creation_date",
            "update_date",
        ]
        read_only_fields = ["id", "tipo_nombre", "status", "status_id", "creation_date", "update_date"]
