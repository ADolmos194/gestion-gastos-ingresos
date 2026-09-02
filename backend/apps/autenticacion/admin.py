from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ["username"]
    list_display = [
        "username",
        "email",
        "first_name",
        "last_name",
        "is_locked",
        "email_verified",
        "failed_login_attempts",
        "last_login",
        "last_logout",
        "is_staff",
    ]
    list_filter = ["is_staff", "is_active", "is_locked", "email_verified"]
    search_fields = ["username", "email", "first_name", "last_name"]
    readonly_fields = ["last_login", "last_logout", "date_joined"]

    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Información personal", {"fields": ("first_name", "last_name", "email")}),
        (
            "Seguridad",
            {"fields": ("failed_login_attempts", "is_locked", "email_verified")},
        ),
        (
            "Permisos",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Fechas", {"fields": ("last_login", "last_logout", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "email", "password1", "password2"),
            },
        ),
    )
