# Padrones Tucumán → BAS

Herramienta web estática para Compañía Sudamericana de Diseño y Distribución S.A. que toma los padrones mensuales de DGR Tucumán y genera dos TXT para BAS:

- **Alícuotas**: formato delimitado por `;`.
- **Coeficientes CM**: formato de ancho fijo con cinco espacios entre CUIT y coeficiente.

## Privacidad

El procesamiento ocurre dentro del navegador. Los ZIP/TXT seleccionados por el usuario no se envían al repositorio ni a un servidor de la aplicación.

## Reglas implementadas

### Coeficiente

1. Si el CUIT figura exento en RG116 → `0`.
2. Si el CUIT figura en RG116 → coeficiente publicado en RG116.
3. Si no figura en RG116 → `1`.

Formato de salida: `0,0000` y `1,0000` usan coma; los demás coeficientes usan punto y cuatro decimales.

### Alícuota

1. RG116 exento → `0`.
2. RG116 con coeficiente `0` → porcentaje RG116 completo.
3. RG116 con coeficiente mayor a `0` → porcentaje RG116 / 2.
4. Sin RG116, ACREDITAN exento → `0`.
5. Sin RG116, ACREDITAN `CM` → porcentaje ACREDITAN / 2, redondeado a 2 decimales.
6. Sin RG116, ACREDITAN `CL` → porcentaje ACREDITAN completo.

El cálculo fue contrastado contra el padrón de octubre 2026, con 125.176 CUIT y coincidencia total de alícuotas respecto del archivo final validado.

## Publicación en GitHub Pages

1. Subir estos archivos a la raíz del repositorio.
2. Ir a **Settings → Pages**.
3. En **Build and deployment**, elegir **Deploy from a branch**.
4. Seleccionar rama **main** y carpeta **/(root)**.
5. Guardar.

La URL quedará normalmente como:

`https://golasouth.github.io/padrones-tucuman/`
