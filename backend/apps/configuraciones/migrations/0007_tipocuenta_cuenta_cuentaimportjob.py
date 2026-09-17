import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('configuraciones', '0006_moneda_monedaimportjob'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TipoCuenta',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('creation_date', models.DateTimeField(auto_now_add=True)),
                ('update_date', models.DateTimeField(auto_now=True)),
                ('name', models.CharField(max_length=50, unique=True)),
                ('description', models.TextField(blank=True, null=True)),
                ('key_creator_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('key_status', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to='configuraciones.status')),
                ('key_updater_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'cfg_tipo_cuentas',
            },
        ),
        migrations.CreateModel(
            name='Cuenta',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('creation_date', models.DateTimeField(auto_now_add=True)),
                ('update_date', models.DateTimeField(auto_now=True)),
                ('name', models.CharField(max_length=100)),
                ('account_number', models.CharField(blank=True, max_length=50, null=True)),
                ('titular_name', models.CharField(blank=True, max_length=150, null=True)),
                ('key_creator_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('key_moneda', models.ForeignKey(on_delete=django.db.models.deletion.RESTRICT, related_name='cuentas', to='configuraciones.moneda')),
                ('key_status', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to='configuraciones.status')),
                ('key_tipo', models.ForeignKey(on_delete=django.db.models.deletion.RESTRICT, related_name='cuentas', to='configuraciones.tipocuenta')),
                ('key_updater_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('key_user', models.ForeignKey(on_delete=django.db.models.deletion.RESTRICT, related_name='cuentas', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'cfg_cuentas',
            },
        ),
        migrations.CreateModel(
            name='CuentaImportJob',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('creation_date', models.DateTimeField(auto_now_add=True)),
                ('update_date', models.DateTimeField(auto_now=True)),
                ('total_rows', models.PositiveIntegerField(blank=True, null=True)),
                ('processed_rows', models.PositiveIntegerField(default=0)),
                ('result', models.JSONField(blank=True, null=True)),
                ('error_message', models.TextField(blank=True, null=True)),
                ('key_creator_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('key_status', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to='configuraciones.status')),
                ('key_updater_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('key_user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'cfg_cuenta_import_jobs',
            },
        ),
    ]
