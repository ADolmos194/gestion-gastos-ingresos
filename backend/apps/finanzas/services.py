from django.db.models import Q, Sum

from apps.configuraciones.cuenta.models import Cuenta
from apps.configuraciones.services import ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME

from .models import Movimiento


def compute_saldos(usuario) -> list[dict]:
    """Saldo de cada Cuenta activa del usuario, calculado al vuelo (no persistido — ver el
    comentario en Movimiento sobre por qué). Solo cuentan los movimientos en estado Activo:
    uno Anulado nunca pasó de verdad, y uno Inactivo se trata como "no confirmado todavía"
    para el cálculo — ninguno de los dos debe mover el saldo real.

    Ingreso suma, Gasto resta — la dirección sale de key_categoria.key_tipo.name, no de un
    campo propio de Movimiento (ver models.py).
    """
    cuentas = (
        Cuenta.objects.filter(key_user=usuario)
        .exclude(key_status__name__in=(VOIDED_STATUS_NAME, "Eliminado"))
        .select_related("key_moneda")
        .order_by("name")
    )

    movimientos_activos = Movimiento.objects.filter(key_user=usuario, key_status__name=ACTIVE_STATUS_NAME)
    por_cuenta = movimientos_activos.values("key_cuenta").annotate(
        ingresos=Sum("amount", filter=Q(key_categoria__key_tipo__name="Ingreso")),
        gastos=Sum("amount", filter=Q(key_categoria__key_tipo__name="Gasto")),
    )
    saldos_por_cuenta_id = {
        row["key_cuenta"]: (row["ingresos"] or 0) - (row["gastos"] or 0) for row in por_cuenta
    }

    return [
        {
            "cuenta_id": str(cuenta.id),
            "cuenta_nombre": cuenta.name,
            "moneda_code": cuenta.key_moneda.code if cuenta.key_moneda else "",
            "saldo": saldos_por_cuenta_id.get(cuenta.id, 0),
        }
        for cuenta in cuentas
    ]
