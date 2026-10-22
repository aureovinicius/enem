// The INEP keeps older booklets under a different official directory.
export function isOfficialBookletURL(value) {
  return typeof value === "string" && /^https:\/\/download\.inep\.gov\.br\/(?:enem\/provas_e_gabaritos\/[A-Za-z0-9_-]+|educacao_basica\/enem\/provas\/(?:(20\d{2})\/(?:CAD_ENEM_)?\1_[A-Za-z0-9_-]+|2017\/cad_1_prova_azul_5112017|(?:2009|201[0-3])\/(?:dia1_caderno1|dia2_caderno7)_azul))\.pdf$/.test(value);
}
