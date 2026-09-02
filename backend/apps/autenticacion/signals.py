from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import User

# "GASTOS E INGRESOS PERMISSION LIMIT" (ver seed_roles.json): rol base que se le asigna a
# todo usuario nuevo. Por sí solo no da acceso al sistema (arranca sin menús en RoleMenu);
# un administrador amplía sus permisos vinculando menús/permisos a este rol después.
DEFAULT_ROLE_ID = "9726bc04-3c0e-4ff5-b547-d4192b403ff5"


@receiver(user_logged_in)
def on_user_logged_in(sender, request, user, **kwargs):
    if user.failed_login_attempts:
        user.reset_failed_attempts()


@receiver(user_logged_out)
def on_user_logged_out(sender, request, user, **kwargs):
    if user is not None:
        user.last_logout = timezone.now()
        user.save(update_fields=["last_logout"])


@receiver(post_save, sender=User)
def on_user_created(sender, instance, created, **kwargs):
    if created:
        _assign_default_role(instance)


def _assign_default_role(user):
    # Imports tardíos: evitan un ciclo de imports entre apps al cargarse en AppConfig.ready().
    from apps.configuraciones.models import Status
    from apps.seguridad.models import Role, UserRole

    role = Role.objects.filter(id=DEFAULT_ROLE_ID).first()
    if role is None:
        # El seed todavía no corrió (p.ej. BD recién creada): no bloquea la creación del
        # usuario, simplemente queda sin rol hasta que se le asigne uno a mano.
        return
    active_status = Status.objects.filter(name__iexact="Activo").first()
    UserRole.objects.get_or_create(key_user=user, key_role=role, defaults={"key_status": active_status})
