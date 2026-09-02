from rest_framework import serializers

from .models import Historial, HistorialDetalle


class HistorialSerializer(serializers.ModelSerializer):
    # Nombre y apellido si el usuario los cargó, si no el email — nunca el username crudo,
    # que es el que menos dice sobre quién hizo el cambio.
    usuario = serializers.SerializerMethodField()

    class Meta:
        model = Historial
        fields = ["id", "evento", "modulo", "nom_tabla", "usuario", "fecha_hora"]
        read_only_fields = fields

    def get_usuario(self, historial: Historial) -> str | None:
        user = historial.key_usuario
        if user is None:
            return None
        nombre = f"{user.first_name} {user.last_name}".strip()
        return nombre or user.email


class HistorialDetalleSerializer(serializers.ModelSerializer):
    class Meta:
        model = HistorialDetalle
        fields = ["id", "columna", "dato_antiguo", "dato_nuevo"]
        read_only_fields = fields
