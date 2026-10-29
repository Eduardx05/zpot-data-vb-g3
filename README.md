# ZPOT Data — Visual Builder Gen 3

**Node.js + TypeScript**, interfaz ZPOT original, comparador, dashboard, diccionario funcional, consolidador y publicador de Business Objects de Oracle Visual Builder Gen 3 mediante proxy local.

## Requisitos y arranque

Node.js 20+ y npm. El navegador no necesita habilitar CORS en Oracle: el servidor Node hace las solicitudes a Business Objects.

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Abre <http://127.0.0.1:8765>. En Windows puedes copiar `.env.example` como `.env` manualmente. `npm run check` valida ambos proyectos TypeScript.

## Datos y repositorio

**Este repositorio es público. No publiques datos de clientes del BNCR, ZIP, resultados ni tokens.** Los 14 ZIP y datasets históricos permanecen únicamente en `private-data/`, excluido mediante `.gitignore`. La versión pública incluye **dos conjuntos de datos DEMO SINTÉTICOS**, sin información real del BNCR, para mostrar el comparador desde el primer inicio. La demo no puede publicarse hacia Oracle.

Para restaurar los ZIP precargados desde el HTML antiguo:

```bash
python scripts/import-standalone.py /ruta/al/BNCR_ZPOT_Comparador_Consolidador_Oracle_GEN3_Pruebas.html
npm start
```

También puedes agregar ZIP nuevos desde **Agregar ZIP**; estos se procesan en tu navegador y no se envían a GitHub. Los archivos nuevos no se guardan automáticamente entre reinicios: puedes volver a cargarlos y recuperar etiquetas desde el JSON de configuración.

Las fuentes históricas, si están disponibles en `private-data/`, se muestran automáticamente al iniciar y pueden seleccionarse para comparación o consolidación. No mezcles datos bancarios con un repositorio público.

## Publicación Oracle sin CORS

Destino predeterminado de desarrollo:

```text
https://oic-vbcs-oicdesarrollo-vb-idmgdptbgc3i.builder.us-ashburn-1.ocp.oraclecloud.com/ic/builder/rt/BNCR_CREDIT_APPROVAL_2026_GEN3_V2/live/resources/data
```

El navegador envía llamadas al **mismo origen local** (`/api/oracle/Configuration`, etc.), y Node reenvía a Oracle. No se permite usar el proxy contra otros dominios ni endpoints arbitrarios.

La configuración se guarda solo en `.env` (nunca en Git):

```env
HOST=127.0.0.1
PORT=8765
ORACLE_AUTH_MODE=public
ENABLE_ORACLE_WRITES=false
```

Para usar Bearer, cambia `ORACLE_AUTH_MODE=bearer` y configura `ORACLE_BEARER_TOKEN=...` en `.env`. Para permitir POST/PATCH **únicamente en un entorno aislado de desarrollo**, cambia `ENABLE_ORACLE_WRITES=true` y reinicia Node. La interfaz requiere confirmación explícita y limita los registros por objeto; la exportación ZIP y la vista previa no escriben en Oracle.

> El segmento `live` en `/ic/builder/rt/.../live/` designa la publicación de una aplicación y no garantiza que el entorno sea producción. Verifica el ambiente y realiza respaldo antes de cualquier carga. La prueba GET no valida permisos POST o PATCH, ni garantiza que la importación conserve dependencias entre objetos.

## Funcionalidades conservadas

- Exploración y diccionario de catálogos, mantenimientos, procesos, etapas, roles y flujo dinámico.
- Selector de ZIP precargados y nuevos, dashboards y casos registrados.
- Comparación de objetos/filas por ID entre varias fuentes.
- Consolidador CSV con deduplicación por `id`, prioridad de `lastUpdateDate`, exportación ZIP con esquema de referencia y auditoría.
- JSON para nombres personalizados, fecha de pase, ambiente declarado, prioridades y preferencias de fuentes.
- Publicador API con GET de comprobación, vista previa, POST/PATCH/Upsert cuando sea admitido, detención y reporte de resultados.

## Seguridad

- Node escucha solo `127.0.0.1`/`localhost`. No se habilita CORS abierto.
- La API valida `Host`, `Origin`, objeto, identificador, método y destino Oracle.
- Autenticación gestionada **solo por el servidor**; los tokens no se transmiten al frontend.
- POST/PATCH requieren dos habilitaciones: variable explícita de servidor y confirmación del usuario en la interfaz.
- El código fuente publicado no contiene archivos ni registros del BNCR.
- Para producción se necesita un procedimiento de migración autorizado con respaldo, validación de esquemas/relaciones y credenciales con privilegios mínimos.

## Orden de carga por relaciones — migración por etapas

En **Publicar en Oracle → Plan de carga por relaciones**, ZPOT calcula un orden topológico utilizando las relaciones `outgoing` del modelo de Business Objects, tomando la metadata de los ZIP de aplicación y del diccionario precargado.

- Los **objetos padre** se importan antes que los objetos dependientes. Por ejemplo, `AbsenceLapseCatalogue` y `AbsenceTypeCatalogue` antes de `AbsenceCatalogue`; `Process` y `ProcessStages` antes de `ProcessStageProcess`; `Cases`, `ProcessStages` y `CaseStageStatus` antes de `CaseStage`.
- El modo predeterminado envía **una etapa a la vez**, pide confirmación adicional por etapa y conserva la auditoría JSON con el orden, los registros procesados y los errores.
- Antes de escribir cada etapa hace GET de la colección y comprueba las referencias a registros padres que no se hayan cargado en esta ejecución, con un máximo de 250 consultas de referencia por etapa. Si la validación falla, se detiene.
- Un error de POST/PATCH **detiene las etapas dependientes**. No se reintentan inserciones automáticamente, para evitar duplicados.
- Si la importación abarca varias tablas con llaves foráneas, hay que preservar los IDs originales o preparar una estrategia de remapeo. No se remapean automáticamente IDs que genere Oracle.
- Las relaciones circulares o las autorreferencias que no puedan resolverse se señalan explícitamente. La herramienta no presume un orden inventado.
- **Restablecer plan** inicia un nuevo intento pero **no revierte** los registros ya insertados. Conciliar y respaldar antes de reintentar. El progreso entre etapas no se guarda al recargar la página.
- El **orden de publicación** proviene de las llaves foráneas del modelo, NO de `orderPos`, que controla el flujo dinámico de negocio.

Este procedimiento está diseñado para **un ambiente de desarrollo aislado**. Un GET exitoso no concede permiso POST/PATCH: el servidor Oracle debe autorizar cada operación. No existe transacción ni rollback global.
