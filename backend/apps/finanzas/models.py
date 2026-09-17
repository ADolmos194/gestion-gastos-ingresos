from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.configuraciones.categoria.models import Categoria
from apps.configuraciones.cuenta.models import Cuenta
from apps.configuraciones.models import BaseModel


class Movimiento(BaseModel):
    """Un gasto o un ingreso puntual — el módulo transaccional real del sistema (todo lo
    demás en Configuraciones es data maestra que este modelo consume).

    A propósito NO tiene un campo "tipo" propio (Gasto/Ingreso): esa clasificación la
    hereda de key_categoria.key_tipo (TipoCategoria ya es Gasto/Ingreso, ver
    apps.configuraciones.categoria.models) — evita el caso contradictorio de un
    movimiento marcado "Ingreso" con una categoría de gasto. Mismo criterio para la
    moneda: no hay un key_moneda propio, se usa la de key_cuenta.key_moneda (una cuenta
    ya tiene una moneda fija) — así no hace falta resolver conversión de moneda en v1.

    Tampoco tiene un campo "saldo" ni Cuenta lo tiene: el saldo de una cuenta se calcula
    sumando/restando sus movimientos activos al vuelo (ver apps.finanzas.services), no se
    persiste — decisión explícita para no arriesgar que un saldo guardado se desincronice
    de los movimientos reales.
    """

    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT, related_name="movimientos")
    key_categoria = models.ForeignKey(Categoria, on_delete=models.RESTRICT, related_name="movimientos")
    key_cuenta = models.ForeignKey(Cuenta, on_delete=models.RESTRICT, related_name="movimientos")
    amount = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    movement_date = models.DateField()
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "fin_movimientos"

    def __str__(self):
        return f"{self.movement_date} - {self.key_categoria.name if self.key_categoria else ''} - {self.amount}"
