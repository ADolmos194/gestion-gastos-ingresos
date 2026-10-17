import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"

import { AuthLoadingScreen } from "@/components/auth-loading-screen"
import { RedirectIfAuthenticated, RequireAuth } from "@/components/require-auth"
import { RequireMenuAccess } from "@/components/require-menu-access"
import { ToastProvider } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/lib/auth-context"
import { pageRoutes } from "@/lib/page-routes"
import ForgotPasswordPage from "@/pages/ForgotPasswordPage"
import LoginPage from "@/pages/LoginPage"
import RegisterPage from "@/pages/RegisterPage"
import VerifyEmailPage from "@/pages/VerifyEmailPage"

const SecurityPage = lazy(() => import("@/pages/SecurityPage"))

function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route
                path="/login"
                element={
                  <RedirectIfAuthenticated>
                    <LoginPage />
                  </RedirectIfAuthenticated>
                }
              />
              <Route
                path="/register"
                element={
                  <RedirectIfAuthenticated>
                    <RegisterPage />
                  </RedirectIfAuthenticated>
                }
              />
              <Route
                path="/forgot-password"
                element={
                  <RedirectIfAuthenticated>
                    <ForgotPasswordPage />
                  </RedirectIfAuthenticated>
                }
              />
              <Route
                path="/verify-email"
                element={
                  <RedirectIfAuthenticated>
                    <VerifyEmailPage />
                  </RedirectIfAuthenticated>
                }
              />
              <Route element={<RequireAuth />}>
                {/* "Seguridad" es de cuenta (no un sujeto de menú): cualquier usuario autenticado
                    la ve, sin depender de RequireMenuAccess. */}
                <Route
                  path="/seguridad"
                  element={
                    <Suspense fallback={<AuthLoadingScreen />}>
                      <SecurityPage />
                    </Suspense>
                  }
                />
                <Route element={<RequireMenuAccess />}>
                  {Object.entries(pageRoutes).map(([subject, { path, component: LazyPage }]) => (
                    <Route
                      key={subject}
                      path={path}
                      element={
                        <Suspense fallback={<AuthLoadingScreen />}>
                          <LazyPage />
                        </Suspense>
                      }
                    />
                  ))}
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ToastProvider>
  )
}

export default App
