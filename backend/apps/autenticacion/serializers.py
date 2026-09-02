from django.contrib.auth.password_validation import validate_password
from django.core import exceptions as django_exceptions
from rest_framework import serializers

from .models import User


class LoginSerializer(serializers.Serializer):
    # Acepta username o email (ver LoginView); trim_whitespace=False porque un
    # espacio en la contraseña es parte de la contraseña.
    username = serializers.CharField(trim_whitespace=False, max_length=150)
    password = serializers.CharField(trim_whitespace=False, write_only=True, style={"input_type": "password"})


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name"]
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(trim_whitespace=False, write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = ["username", "email", "first_name", "last_name", "password"]

    def validate_password(self, value):
        # Corre los AUTH_PASSWORD_VALIDATORS de settings.py (largo mínimo, no numérica, etc.)
        try:
            validate_password(value)
        except django_exceptions.ValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class VerifyEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=6, min_length=6)


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=6, min_length=6)
    new_password = serializers.CharField(trim_whitespace=False, write_only=True, style={"input_type": "password"})

    def validate_new_password(self, value):
        try:
            validate_password(value)
        except django_exceptions.ValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False, write_only=True, style={"input_type": "password"})
    new_password = serializers.CharField(trim_whitespace=False, write_only=True, style={"input_type": "password"})

    def validate_new_password(self, value):
        try:
            validate_password(value, user=self.context.get("user"))
        except django_exceptions.ValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": "La nueva contraseña debe ser diferente a la actual."}
            )
        return attrs
