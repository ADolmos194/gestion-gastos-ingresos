from rest_framework import serializers

from . import message
from .models import Movimiento


class MovimientoSerializer(serializers.ModelSerializer):
    categoria_nombre = serializers.CharField(source="key_categoria.name", read_only=True)
    tipo_nombre = serializers.CharField(source="key_categoria.key_tipo.name", read_only=True)
    cuenta_nombre = serializers.CharField(source="key_cuenta.name", read_only=True)
    moneda_code = serializers.CharField(source="key_cuenta.key_moneda.code", read_only=True)
    status = serializers.CharField(source="key_status.name", read_only=True)
    # El frontend compara esto contra VITE_STATUS_ACTIVATE (ver frontend/.env) para saber
    # si pintar la celda de Estado en verde, en vez de comparar por el nombre.
    status_id = serializers.UUIDField(source="key_status_id", read_only=True)

    class Meta:
        model = Movimiento
        fields = [
            "id",
            "movement_date",
            "key_categoria",
            "categoria_nombre",
            "tipo_nombre",
            "key_cuenta",
            "cuenta_nombre",
            "moneda_code",
            "amount",
            "description",
            "status",
            "status_id",
            "creation_date",
            "update_date",
        ]
        read_only_fields = [
            "id",
            "categoria_nombre",
            "tipo_nombre",
            "cuenta_nombre",
            "moneda_code",
            "status",
            "status_id",
            "creation_date",
            "update_date",
        ]

    # key_categoria/key_cuenta usan el queryset por defecto de DRF (sin filtrar por dueño):
    # sin este chequeo, un usuario podría enviar a mano el id de una Categoria/Cuenta ajena
    # y quedaría vinculada igual — mismo IDOR que se encontró y corrigió en
    # CuentaSerializer.validate_key_moneda (ver apps.configuraciones.cuenta.serializers),
    # acá aplicado desde el primer commit de este módulo en vez de como fix posterior.
    def validate_key_categoria(self, categoria):
        usuario = self.context.get("usuario")
        if usuario is not None and categoria.key_user_id != usuario.id:
            raise serializers.ValidationError(message.categoria_no_existe(categoria.id))
        return categoria

    def validate_key_cuenta(self, cuenta):
        usuario = self.context.get("usuario")
        if usuario is not None and cuenta.key_user_id != usuario.id:
            raise serializers.ValidationError(message.cuenta_no_existe(cuenta.id))
        return cuenta
