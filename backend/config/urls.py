"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.contrib import admin
from django.http import HttpResponseGone
from django.urls import include, path

urlpatterns = [
    path('api/auth/', include('apps.autenticacion.urls')),
    path('api/configuraciones/', include('apps.configuraciones.urls')),
    path('api/finanzas/', include('apps.finanzas.urls')),
    path('api/seguridad/', include('apps.seguridad.urls')),
]

if settings.ENABLE_ADMIN:
    urlpatterns.append(path('admin/', admin.site.urls))
else:
    # El admin de Django es la mayor superficie de ataque del proyecto (login sin 2FA ni
    # bloqueo por intentos, solo el rate-limit de nginx) y los roles/permisos/usuarios ya se
    # administran desde la propia UI. Fuera en producción por defecto (ver ENABLE_ADMIN en
    # config/settings.py). 410 Gone (no 404) para que no caiga a la SPA con un 200 ok.
    urlpatterns.append(
        path(
            'admin/',
            lambda request: HttpResponseGone(
                '<h1>410 Gone</h1><p>El panel de administración está deshabilitado.</p>',
                content_type='text/html',
            ),
        )
    )
