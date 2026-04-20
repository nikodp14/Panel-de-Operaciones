// =========================
// NORMALIZADORES
// =========================

function normalizeVariantColor(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractColorFromMlVariant(variantRaw) {
  if (!variantRaw) return '';

  const v = normalizeVariantColor(variantRaw);

  return v
    .replace(/\bizquierdo\s*\/\s*derecho\b/g, '')
    .replace(/\bizquierdo\b/g, '')
    .replace(/\bderecho\b/g, '')
    .replace(/amboslados|ambos lados/g, '')
    .replace(/[\/\-+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBaseCodes(value) {
  const s = String(value || '').toUpperCase();

  //const noSuffix = s.split('-')[0];
  //const parts = noSuffix.split('/');

  const parts = s.split('/').map(p => p.split('-')[0]);

  return parts
    .map(p => p.replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean);
}

function matchesFibraCarbono(oVar, oName, mlVariant) {
  const a = 'fibra de carbono';
  const b = 'fibra carbono';

  if (mlVariant === a || mlVariant === b) {
    if (oVar) return oVar === a || oVar === b;
    return oName.includes(a) || oName.includes(b);
  }

  return false;
}

function resolveMlVariant({
  publication,
  mlVariantRaw,
  mlTitle,
  odooProducts,
  variantesValidarSet
}) {

  let mlVariant = extractColorFromMlVariant(mlVariantRaw);
  mlVariant = normalizeVariantColor(mlVariant);

  mlVariant = mlVariant
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleHasOriginal =
    normalizeVariantColor(mlTitle).includes('original');

  const mlVariantIsNoVariant =
    ['izquierdo/conductor', 'original'].includes(mlVariant) ||
    titleHasOriginal;

  if (mlTitle && mlVariantRaw && mlTitle === mlVariantRaw) {
    mlVariant = '';
  }

  if (mlVariantIsNoVariant) {
    mlVariant = '';
  }

  const cleanPub = String(publication)
  .replace(/[^0-9A-Z]/g, '');
  
  /*const allMatchesByCode = odooProducts.filter(o =>
    extractBaseCodes(o.barcode).some(code =>
      code.includes(cleanPub)
    )
  );*/
  
  const allMatchesByCode = odooProducts.filter(o => {

    const barcodeCodes = extractBaseCodes(o.barcode || '');
    const defaultCodes = extractBaseCodes(o.default_code || '');

    return [...barcodeCodes, ...defaultCodes].some(code =>
      code.includes(cleanPub)
    );

  });

  let matches = allMatchesByCode;

  // 1️⃣ Intentar match por variante
  if (mlVariant) {

    matches = allMatchesByCode.filter(o => {

      const oVar = o.variantNorm || o.variant || '';
      const oName = o.nameNorm || o.name || '';

      if (matchesFibraCarbono(oVar, oName, mlVariant)) {
        return true;
      }

      if (oVar) {
        return oVar === mlVariant;
      }

      return oName.includes(mlVariant);

    });

  }

  // 2️⃣ Fallback controlado
  if (matches.length === 0) {

    const mlVariantFull = mlVariant;
    const isColorVariant =
      mlVariant && variantesValidarSet.has(mlVariant);

    const isCompositeVariant =
      mlVariantFull && mlVariantFull.includes(' ');

    let strictVariantMatches = [];

    if (mlVariantFull) {

      strictVariantMatches = allMatchesByCode.filter(o => {

        const oVar = o.variantNorm || '';
        const oName = o.nameNorm || '';

        if (matchesFibraCarbono(oVar, oName, mlVariantFull)) {
          return true;
        }

        if (oVar) {
          return oVar === mlVariantFull;
        }

        return oName.includes(mlVariantFull);

      });

    }

    if (strictVariantMatches.length > 0) {

      matches = strictVariantMatches;

    } else if (
      (isColorVariant || isCompositeVariant) &&
      allMatchesByCode.length > 1
    ) {

      // 🔒 no permitir fallback si hay varias variantes
      matches = [];

    } else {

      // ✅ fallback por código
      matches = allMatchesByCode;

    }

  }

  return matches;
}