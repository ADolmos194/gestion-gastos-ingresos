from django.urls import path

from . import views

app_name = "autenticacion"

urlpatterns = [
    path("csrf/", views.CsrfCookieView.as_view(), name="csrf"),
    path("register/", views.RegisterView.as_view(), name="register"),
    path("verify-email/", views.VerifyEmailView.as_view(), name="verify-email"),
    path("resend-verification/", views.ResendVerificationView.as_view(), name="resend-verification"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("login/2fa/", views.LoginOtpView.as_view(), name="login-2fa"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("me/", views.MeView.as_view(), name="me"),
    path("refresh/", views.RefreshSessionView.as_view(), name="refresh"),
    path("change-password/", views.ChangePasswordView.as_view(), name="change-password"),
    path("forgot-password/", views.ForgotPasswordView.as_view(), name="forgot-password"),
    path("reset-password/", views.ResetPasswordConfirmView.as_view(), name="reset-password"),
    # 2FA (TOTP)
    path("2fa/status/", views.TwoFactorStatusView.as_view(), name="2fa-status"),
    path("2fa/setup/", views.TwoFactorSetupView.as_view(), name="2fa-setup"),
    path("2fa/confirm/", views.TwoFactorConfirmView.as_view(), name="2fa-confirm"),
    path("2fa/disable/", views.TwoFactorDisableView.as_view(), name="2fa-disable"),
    path("2fa/recovery/regenerate/", views.TwoFactorRecoveryRegenerateView.as_view(), name="2fa-recovery"),
    # Cambio de correo
    path("change-email/request/", views.ChangeEmailRequestView.as_view(), name="change-email-request"),
    path("change-email/confirm/", views.ChangeEmailConfirmView.as_view(), name="change-email-confirm"),
    # Sesiones activas
    path("sessions/", views.ActiveSessionsView.as_view(), name="sessions"),
    path("sessions/revoke/", views.RevokeSessionView.as_view(), name="session-revoke"),
    path("sessions/logout-all/", views.LogoutAllSessionsView.as_view(), name="sessions-logout-all"),
]
