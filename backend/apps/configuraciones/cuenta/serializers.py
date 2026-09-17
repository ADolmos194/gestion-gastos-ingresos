from rest_framework import serializers

from . import message
from .models import Cuenta, TipoCuenta


class TipoCuentaSerializer(serializers.ModelSerializer):
    class Meta:
        model = TipoCuenta
        fields = ["id", "name"]
        read_only_fields = fields


class CuentaSerializer(serializers.ModelSerializer):
    tipo_nombre = serializers.CharField(source="key_tipo.name", read_only=True)
    moneda_code = serializers.CharField(source="key_moneda.code", read_only=True)
    status = serializers.CharField(source="key_status.name", read_only=True)
    # El frontend compara esto contra VITE_STATUS_ACTIVATE (ver frontend/.env) para saber
    # si pintar la celda de Estado en verde, en vez de comparar por el nombre.
    status_id = serializers.UUIDField(source="key_status_id", read_only=True)

    class Meta:
        model = Cuenta
        fields = [
            "id",
            "name",
            "key_tipo",
            "tipo_nombre",
            "key_moneda",
            "moneda_code",
            "account_number",
            "titular_name",
            "status",
            "status_id",
            "creation_date",
            "update_date",
        ]
        read_only_fields = ["id", "tipo_nombre", "moneda_code", "status", "status_id", "creation_date", "update_date"]

    def validate_key_moneda(self, moneda):
        # key_moneda usa el queryset por defecto de DRF (Moneda.objects.all()), sin filtrar
        # por dueño: sin este chequeo, un usuario podría vincular su Cuenta a una Moneda
        # ajena mandando su id a mano (bulk-save no pasa por ningún dropdown que lo impida).
        # El usuario que está guardando viaja en el context (ver _crear_cuentas/
        # _actualizar_cuentas en views.py), no hay request acá porque estas vistas son
        # function-based y arman el serializer a mano, sin pasar por generics de DRF.
        usuario = self.context.get("usuario")
        if usuario is not None and moneda.key_user_id != usuario.id:
            raise serializers.ValidationError(message.moneda_no_existe(moneda.id))
        return moneda
