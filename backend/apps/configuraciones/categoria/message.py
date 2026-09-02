"""Mensajes de texto (errores, permisos, etc.) del módulo de Categorías — centralizados
acá para no tener strings sueltos repartidos en views.py, y para que si el texto cambia
haya un solo lugar donde tocarlo.
"""

# Permisos (CategoriaBulkSaveView) — un mensaje por tipo de operación porque un mismo
# request puede mezclar create+update+delete, cada bolsa se valida contra su propio
# permiso.
NO_PERMISO_CREAR = "No tenés permiso para crear categorías."
NO_PERMISO_EDITAR = "No tenés permiso para editar categorías."
NO_PERMISO_ANULAR = "No tenés permiso para anular categorías."

# Guardado en lote (CategoriaBulkSaveView)
UPDATE_SIN_ID = "Cada fila de 'updated' necesita 'id'."
ANULAR_NO_EXISTE = "Alguna de las categorías a anular no existe o no te pertenece."
RESTAURAR_NO_EXISTE = "Alguna de las categorías a restaurar no existe o no te pertenece."
INACTIVAR_NO_EXISTE = "Alguna de las categorías a inactivar no existe o no te pertenece."


def categoria_no_existe(categoria_id) -> str:
    return f"La categoría {categoria_id} no existe o no te pertenece."


# Importación — validaciones a nivel de archivo (_parse_categorias_file)
FALTA_ARCHIVO = "Falta el archivo .xlsx."


def archivo_ilegible(detalle) -> str:
    return f"No se pudo leer el archivo: {detalle}"


def columnas_faltantes(columnas) -> str:
    return f"Faltan columnas obligatorias: {', '.join(sorted(columnas))}."


# Importación — validaciones fila por fila (_parse_categorias_file)
NOMBRE_OBLIGATORIO = "El nombre es obligatorio."


def nombre_duplicado(name: str) -> str:
    return f'Ya existe una categoría llamada "{name}".'


def tipo_invalido(tipo_name: str) -> str:
    return f'Tipo "{tipo_name}" inválido (usar Gasto o Ingreso).'
