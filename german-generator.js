import {
  COORDINATORS,
  DISCOURSE_ADVERBS,
  GERMAN_ADJECTIVE_COMPARATIVES,
  GERMAN_ADJECTIVE_SUPERLATIVES,
  GERMAN_IRREGULAR_PAST,
  GERMAN_IRREGULAR_PRESENT,
  GERMAN_PARTICIPLES,
  INTERROGATIVE_FORMS,
  KNOWN_GERMAN_NOUNS,
  LATIN_ETHNONYM_LEMMAS,
  LATIN_PREPOSITIONS,
  LATIN_LOCATIVES,
  PERSONAL_PRONOUNS,
  RELATIVE_FORMS,
  SUBORDINATORS,
  SUBSTANTIVIZED_ADJECTIVES,
  VERB_CLASSES,
  VERB_FRAMES
} from "./latin-language-data.js";
import { caseIncludes, firstCase, isAdverb, isEsse, isFinite, isModifier, isNominal, isProper, normalizeLatin, partOf } from "./latin-analysis.js";

const NEGATIONS = new Set(["non", "haud"]);
const POSSESSIVE_STEMS = Object.freeze({ meus: "mein", tuus: "dein", suus: "sein", noster: "unser", vester: "euer" });

/** Stage 6: realise an interpreted semantic structure as a German sentence. */
export function generateGermanSentence(semantics, options = {}) {
  if (!semantics?.words?.length) return "";
  const context = { semantics, words: semantics.words, options };
  const construction = type => semantics.constructions?.find(item => item.type === type);
  const leadingCum = inferLeadingCumClauses(context);

  let text = "";
  if (semantics.type === "question" && semantics.clauses.length === 1 && context.words.some(word => INTERROGATIVE_FORMS.has(word.normalized))) text = renderDirectQuestion(context);
  else if (construction("indirect-question") || semantics.clauses.some(clause => clause.type === "indirect-question")) text = renderIndirectQuestion(context);
  else if (construction("free-relative")) text = renderFreeRelative(context, construction("free-relative"));
  else if (construction("aci")) text = renderAci(context, construction("aci"));
  else if (construction("nci")) text = renderNci(context, construction("nci"));
  else if (construction("infinitive-command")) text = renderInfinitiveCommand(context, construction("infinitive-command"));
  else if (construction("gerundive-obligation")) text = renderGerundiveObligation(context, construction("gerundive-obligation"));
  else if (construction("relative-clause")) text = renderRelativeSentence(context, construction("relative-clause"));
  else if (construction("ablative-absolute")) text = renderWithAblativeAbsolute(context, construction("ablative-absolute"));
  else if (construction("present-participle") || construction("perfect-passive-participle") || construction("participial-phrase")) text = renderParticipialSentence(context, construction("present-participle") || construction("perfect-passive-participle") || construction("participial-phrase"));
  else if (leadingCum) text = renderLeadingCumComplex(context, leadingCum);
  else if (semantics.clauses.length > 1) text = renderClauseComplex(context);
  else if (semantics.clauses[0]?.type === "prohibition" || context.words[0]?.normalized === "ne") text = renderProhibition(context);
  else text = renderClause(context, semantics.clauses[0], {});

  return text;
}

/** Stage 7: typography and conservative, lexical-content-neutral cleanup. */
export function postprocessGerman(value = "", options = {}) {
  let text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([„«])\s+/g, "$1")
    .replace(/\s+([“»])/g, "$1")
    .replace(/\s+,\s*,+/g, ",")
    .trim();
  if (!text) return "";
  text = text[0].toLocaleUpperCase("de") + text.slice(1);
  if (!/[.!?]$/.test(text)) text += options.question ? "?" : ".";
  return text;
}

function renderClauseComplex(context) {
  const main = context.semantics.clauses.find(clause => clause.type === "main") || context.semantics.clauses[0];
  const coordinates = context.semantics.clauses.filter(clause => clause.type === "coordinate");
  const nonCoordinates = context.semantics.clauses.filter(clause => clause !== main && clause.type !== "coordinate");
  if (coordinates.length && !nonCoordinates.length) {
    const subjectIndexes = main.roles.subject || [];
    const mainText = renderClause(context, main, {});
    const rendered = coordinates.map(clause => {
      const inheritedSubject = !clause.roles.subject.length && (subjectIndexes.length > 0 || main.headIndex != null);
      return renderClause(context, clause, { omitSubject: inheritedSubject });
    });
    if (rendered.length === 1) {
      let connector = coordinates[0].conjunction || "und";
      const leftNegated = main.tokenIndexes.some(index => NEGATIONS.has(context.words[index].normalized));
      if (leftNegated && ["sed", "at", "autem"].includes(coordinates[0].marker)) connector = "sondern";
      return `${mainText}, ${connector} ${lowerFirst(rendered[0])}`;
    }
    return `${mainText}, ${rendered.slice(0, -1).map(lowerFirst).join(", ")} und ${lowerFirst(rendered.at(-1))}`;
  }
  const dependent = context.semantics.clauses.find(clause => clause !== main);
  if (!dependent) return renderClause(context, main, {});
  const dependentFirst = Math.min(...dependent.tokenIndexes) < Math.min(...main.tokenIndexes);
  const relation = clauseConjunction(dependent, context.words);

  if (dependent.type === "final") {
    const sameSubject = sameClauseSubject(main, dependent, context.words);
    const dependentBody = sameSubject ? renderPurposeInfinitive(context, dependent) : renderClause(context, dependent, { subordinate: true, omitMarker: true });
    const mainText = renderClause(context, main, {});
    return `${mainText}, ${sameSubject ? "um" : "damit"} ${lowerFirst(dependentBody)}`;
  }

  const dependentText = renderClause(context, dependent, { subordinate: true, omitMarker: true });
  if (dependentFirst) {
    const mainText = renderClause(context, main, { inverted: true });
    return `${capitalize(relation)} ${lowerFirst(dependentText)}, ${lowerFirst(mainText)}`;
  }
  const mainText = renderClause(context, main, {});
  let connector = dependent.type === "coordinate" ? dependent.conjunction || relation : relation;
  if (dependent.type === "coordinate") {
    const leftNegated = main.tokenIndexes.some(index => NEGATIONS.has(context.words[index].normalized));
    if (leftNegated && ["sed", "at", "autem"].includes(dependent.marker)) connector = "sondern";
    const inheritedSubject = !dependent.roles.subject.length && main.roles.subject.length;
    const rightText = renderClause(context, dependent, { subordinate: false, omitSubject: inheritedSubject });
    return `${mainText}, ${connector} ${lowerFirst(rightText)}`;
  }
  return `${mainText}, ${connector} ${lowerFirst(dependentText)}`;
}

/*
 * A leading cum is unambiguously clausal when it introduces its own finite
 * verb and another finite verb follows. This conservative fallback keeps the
 * realiser useful when an upstream morphology source labelled cum as a
 * preposition even though the complete sentence disproves that reading.
 */
function inferLeadingCumClauses(context) {
  const { words } = context;
  if (context.semantics.clauses.length !== 1 || words[0]?.normalized !== "cum") return null;
  const finite = words.filter(isFinite);
  if (finite.length < 2) return null;
  const cumHasConjunctionReading = partOf(words[0]) === "conj" || words[0].entries?.some(entry => entry.pos === "conj");
  if (!cumHasConjunctionReading && finite[0].morphology.mood !== "subjunctive") return null;
  const dependentIndexes = range(0, finite[0].index);
  const mainIndexes = range(finite[0].index + 1, words.length - 1);
  return {
    dependent: projectedClause(context.semantics.clauses[0], dependentIndexes, finite[0].index, "temporal", 0, words),
    main: projectedClause(context.semantics.clauses[0], mainIndexes, finite[1].index, "main", null, words),
    relation: ["perfect", "pluperfect"].includes(finite[0].morphology.tense) ? "Nachdem" : "Als"
  };
}

function renderLeadingCumComplex(context, inferred) {
  const dependent = renderClause(context, inferred.dependent, { subordinate: true, omitMarker: true });
  const main = renderClause(context, inferred.main, { inverted: true });
  return `${inferred.relation} ${lowerFirst(dependent)}, ${lowerFirst(main)}`;
}

function projectedClause(source, tokenIndexes, headIndex, type, markerIndex, words) {
  const allowed = new Set(tokenIndexes);
  const filter = values => (values || []).filter(index => allowed.has(index));
  const roles = {
    subject: filter(source.roles.subject),
    directObject: filter(source.roles.directObject),
    indirectObject: filter(source.roles.indirectObject),
    genitive: filter(source.roles.genitive),
    ablative: filter(source.roles.ablative),
    prepositional: (source.roles.prepositional || []).filter(item => item.prepositionIndex !== markerIndex && allowed.has(item.prepositionIndex) && allowed.has(item.objectIndex)),
    predicates: filter(source.roles.predicates),
    adverbial: filter(source.roles.adverbial),
    vocative: filter(source.roles.vocative)
  };
  if (!roles.subject.length) {
    const inferredSubject = tokenIndexes.find(index => index !== markerIndex && index !== headIndex && canBeCase(words[index], "nominative"));
    if (inferredSubject != null) roles.subject.push(inferredSubject);
  }
  if (roles.subject.length) {
    const subjectSet = new Set(roles.subject);
    roles.directObject = roles.directObject.filter(index => !subjectSet.has(index));
    roles.indirectObject = roles.indirectObject.filter(index => !subjectSet.has(index));
    roles.genitive = roles.genitive.filter(index => !subjectSet.has(index));
    roles.ablative = roles.ablative.filter(index => !subjectSet.has(index));
  }
  return { ...source, type, tokenIndexes, headIndex, markerIndex, marker: markerIndex == null ? null : "cum", roles };
}

function canBeCase(word, grammaticalCase) {
  if (!word) return false;
  if (caseIncludes(word.morphology, grammaticalCase)) return true;
  return [...(word.candidates || []), ...(word.morphologies || []).map(morphology => ({ morphology }))]
    .some(candidate => isNominal({ ...word, morphology: candidate.morphology }) && caseIncludes(candidate.morphology, grammaticalCase));
}

function renderClause(context, clause, options = {}) {
  if (!clause) return "";
  const { words } = context;
  const purposeConstruction = !options.skipNonFinitePurpose && context.semantics.constructions?.find(item =>
    ["gerund-purpose", "gerundive-purpose", "supine-purpose"].includes(item.type)
    && item.governingIndex != null
    && clause.tokenIndexes.includes(item.governingIndex)
  );
  if (purposeConstruction) return renderNonFinitePurpose(context, clause, options, purposeConstruction);
  const allowed = new Set(clause.tokenIndexes);
  const consumed = dependentExclusionClosure(context, new Set(options.exclude || []));
  if (options.omitMarker && clause.markerIndex != null) consumed.add(clause.markerIndex);
  const finite = clause.headIndex != null ? words[clause.headIndex] : clause.tokenIndexes.map(index => words[index]).find(isFinite);
  if (!finite) return renderEllipticalClause(context, clause, consumed);
  consumed.add(finite.index);

  const vocativeText = clause.roles.vocative
    .filter(index => allowed.has(index) && !consumed.has(index))
    .map(index => renderNominal(context, index, "nominative", consumed, { articlelessProper: true }))
    .filter(Boolean)
    .join(" und ");
  const firstIndex = Math.min(...clause.tokenIndexes);
  const connectiveIndex = clause.type === "main" && COORDINATORS[words[firstIndex]?.normalized] ? firstIndex : null;
  const leadingConnective = connectiveIndex == null ? "" : COORDINATORS[words[connectiveIndex].normalized];
  if (connectiveIndex != null) consumed.add(connectiveIndex);

  const perfectPassive = findPerfectPassive(context, finite, allowed);
  if (perfectPassive) consumed.add(perfectPassive.index);
  const infinitiveSubject = context.semantics.constructions?.find(item =>
    item.type === "infinitive-subject" && item.governingIndex === finite.index && allowed.has(item.infinitiveIndex)
  );
  if (infinitiveSubject) consumed.add(infinitiveSubject.infinitiveIndex);
  const subjects = clause.roles.subject.filter(index => allowed.has(index) && !consumed.has(index));
  subjects.forEach(index => consumed.add(index));
  const coordinatedSubject = context.semantics.dependencies?.some(dependency =>
    dependency.type === "coordination"
    && subjects.includes(dependency.headIndex)
    && subjects.includes(dependency.dependentIndex)
  );
  const agreement = verbAgreement(finite, subjects.map(index => words[index]), { coordinated: coordinatedSubject });
  const subjectText = infinitiveSubject
    ? nominalizedInfinitive(germanInfinitive(words[infinitiveSubject.infinitiveIndex]))
    : subjects.length ? renderSubject(context, subjects, consumed)
      : options.omitSubject || finite.morphology?.mood === "imperative" ? "" : implicitSubject(agreement);
  const predicate = perfectPassive
    ? renderPerfectPassiveVerb(context, perfectPassive, finite, agreement)
    : renderFiniteVerb(context, finite, agreement, {
      narrative: options.narrative || context.semantics.clauses.length > 1,
      counterfactual: clause.type === "conditional" || context.semantics.clauses.some(item => item.type === "conditional" && words[item.headIndex]?.morphology?.mood === "subjunctive")
    });

  const idiom = context.semantics.constructions?.find(item => item.type === "idiom" && item.headIndex === finite.index);
  if (idiom) idiom.indexes.forEach(index => consumed.add(index));
  const effectivePredicate = idiom ? conjugateGerman(idiom.german, agreement, germanTense(finite.morphology, true)) : predicate;
  const expressions = context.semantics.constructions?.filter(item =>
    item.type === "expression" && item.kind !== "interrogative" && item.indexes.every(index => allowed.has(index))
  ) || [];
  expressions.forEach(item => item.indexes.forEach(index => consumed.add(index)));
  const expressionAdverbs = expressions.map(item => item.german).filter(Boolean);

  const nonFiniteModifierIndexes = new Set(context.semantics.constructions
    ?.filter(item => ["gerund", "gerund-purpose"].includes(item.type))
    .flatMap(item => item.modifierIndexes || []) || []);
  const comparisonMarkerIndexes = new Set(context.semantics.constructions
    ?.filter(item => item.type === "comparison")
    .map(item => item.markerIndex)
    .filter(index => index != null) || []);
  const adverbs = [...expressionAdverbs, ...renderAdverbials(context, clause.roles.adverbial.filter(index =>
    !consumed.has(index) && allowed.has(index) && !nonFiniteModifierIndexes.has(index) && !comparisonMarkerIndexes.has(index)
  ), consumed)];
  const comparisonConstructions = context.semantics.constructions?.filter(item =>
    item.type === "comparison" && item.clauseId === clause.id && item.standardIndex != null
  ) || [];
  const comparisonStandards = new Set(comparisonConstructions.map(item => item.standardIndex));
  const indirect = clause.roles.indirectObject.filter(index => !consumed.has(index)).map(index => renderNominal(context, index, "dative", consumed));
  const direct = clause.roles.directObject.filter(index => !consumed.has(index) && !comparisonStandards.has(index)).map(index => {
    const object = words[index];
    if (VERB_CLASSES.motion.has(finite.lemma) && isProper(object)) return `nach ${renderNominal(context, index, "nominative", consumed)}`;
    const germanCase = VERB_FRAMES[finite.lemma]?.germanDirectCase || "accusative";
    return renderNominal(context, index, germanCase, consumed);
  });
  const frame = VERB_FRAMES[finite.lemma];
  const ablativeParts = clause.roles.ablative.filter(index => !consumed.has(index) && !comparisonStandards.has(index)).map(index => {
    const nominal = renderNominal(context, index, frame?.germanAblativeCase || "dative", consumed);
    if (frame?.germanAblativePreposition) return contractPreposition(`${frame.germanAblativePreposition} ${nominal}`);
    if (frame?.germanAblativeCase) return nominal;
    return defaultAblativePhrase(words[index], nominal);
  });
  const ablatives = ablativeParts.length ? [joinGerman(ablativeParts, "und")] : [];
  const prepositionalParts = clause.roles.prepositional.filter(item => !consumed.has(item.prepositionIndex) && !consumed.has(item.objectIndex)).map(item => {
    consumed.add(item.prepositionIndex);
    const noun = renderNominal(context, item.objectIndex, item.germanCase || "dative", consumed);
    return contractPreposition(`${item.german} ${noun}`);
  });
  const prepositional = prepositionalParts.length > 1 ? [joinGerman(prepositionalParts, "und")] : prepositionalParts;
  const partitiveConstructions = context.semantics.constructions?.filter(item =>
    item.type === "partitive-genitive" && item.clauseId === clause.id
  ) || [];
  const partitives = partitiveConstructions.map(item => renderPartitiveGenitive(context, item, consumed)).filter(Boolean);
  const partitiveIndexes = new Set(partitiveConstructions.flatMap(item => item.memberIndexes || []));
  const genitives = clause.roles.genitive.filter(index => !consumed.has(index) && !partitiveIndexes.has(index)).map(index => renderNominal(context, index, "genitive", consumed));
  const predicateNominals = isEsse(finite) ? clause.tokenIndexes
    .filter(index => !consumed.has(index) && !comparisonStandards.has(index) && isNominal(words[index]) && caseIncludes(words[index].morphology, "nominative"))
    .map(index => renderNominal(context, index, "nominative", consumed, { indefinite: true }))
    .filter(Boolean) : [];
  const comparisons = comparisonConstructions.map(item => {
    if (item.markerIndex != null) consumed.add(item.markerIndex);
    const standard = renderNominal(context, item.standardIndex, "nominative", consumed, { articlelessProper: true });
    return `als ${standard}`;
  }).filter(Boolean) || [];
  const predicateAdjectives = clause.tokenIndexes.filter(index => !consumed.has(index) && partOf(words[index]) === "adj").map(index => {
    consumed.add(index);
    return germanAdjectiveDegree(words[index], { predicate: true });
  });
  const complementaryInfinitives = context.semantics.constructions?.filter(item => item.type === "complementary-infinitive" && item.governingIndex === finite.index && allowed.has(item.infinitiveIndex) && !consumed.has(item.infinitiveIndex)) || [];
  const infinitives = complementaryInfinitives.map(item => {
    consumed.add(item.infinitiveIndex);
    const value = germanInfinitive(words[item.infinitiveIndex]);
    return item.withZu ? germanZuInfinitive(value) : value;
  }).filter(Boolean);
  const specifications = context.semantics.constructions?.filter(item =>
    item.type === "supine-specification"
    && allowed.has(item.supineIndex)
    && !consumed.has(item.supineIndex)
  ).map(item => {
    consumed.add(item.supineIndex);
    return germanZuInfinitive(germanInfinitive(words[item.supineIndex]));
  }).filter(Boolean) || [];
  const gerunds = context.semantics.constructions?.filter(item =>
    item.type === "gerund"
    && allowed.has(item.gerundIndex)
    && !consumed.has(item.gerundIndex)
  ).map(item => renderGerundCase(context, item, consumed)).filter(Boolean) || [];
  const substantivizedParticiples = context.semantics.constructions?.filter(item =>
    item.type === "substantivized-participle"
    && item.clauseId === clause.id
    && !consumed.has(item.participleIndex)
  ).map(item => {
    consumed.add(item.participleIndex);
    return renderSubstantivizedParticiple(words[item.participleIndex], item.grammaticalCase);
  }).filter(Boolean) || [];
  const negated = clause.tokenIndexes.some(index => NEGATIONS.has(words[index].normalized));
  clause.tokenIndexes.filter(index => NEGATIONS.has(words[index].normalized)).forEach(index => consumed.add(index));
  const remaining = clause.tokenIndexes.filter(index => !consumed.has(index) && !isStructural(words[index]) && !isFinite(words[index])).map(index => renderLooseWord(context, index, consumed)).filter(Boolean);
  const complements = [...adverbs, ...indirect, ...direct, ...ablatives, ...prepositional, ...partitives, ...genitives, ...predicateNominals, ...predicateAdjectives, ...comparisons, ...gerunds, ...substantivizedParticiples, ...remaining].filter(Boolean);
  const verb = splitGermanVerb(effectivePredicate);

  const decorate = value => {
    let text = value;
    if (vocativeText) text = `${vocativeText}, ${lowerFirst(text)}`;
    if (leadingConnective && !options.subordinate) text = `${capitalize(leadingConnective)} ${lowerFirst(text)}`;
    return text;
  };

  if (options.subordinate) {
    const ending = verb.separable && verb.tail ? `${verb.tail}${verb.head}` : [verb.tail, verb.head].filter(Boolean).join(" ");
    return decorate([subjectText, verb.middle, ...complements, negated ? "nicht" : "", ...infinitives, ...specifications, ending].filter(Boolean).join(" "));
  }
  if (options.inverted) return decorate([verb.head, subjectText, verb.middle, ...complements, negated ? "nicht" : "", ...infinitives, ...specifications, verb.tail].filter(Boolean).join(" "));
  return decorate([subjectText, verb.head, verb.middle, ...complements, negated ? "nicht" : "", ...infinitives, ...specifications, verb.tail].filter(Boolean).join(" "));
}

function dependentExclusionClosure(context, initial) {
  const excluded = new Set(initial);
  const dependencies = context.semantics.dependencies || [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of dependencies) {
      if (excluded.has(dependency.headIndex) && !excluded.has(dependency.dependentIndex)) {
        excluded.add(dependency.dependentIndex);
        changed = true;
      }
      if (dependency.type === "prepositional-object"
        && excluded.has(dependency.dependentIndex)
        && !excluded.has(dependency.headIndex)) {
        excluded.add(dependency.headIndex);
        changed = true;
      }
    }
  }
  return excluded;
}

function renderEllipticalClause(context, clause, consumed = new Set()) {
  const subjects = (clause.roles.subject || []).filter(index => !consumed.has(index))
    .map(index => renderNominal(context, index, "nominative", consumed));
  const prepositional = (clause.roles.prepositional || []).filter(item =>
    !consumed.has(item.prepositionIndex) && !consumed.has(item.objectIndex)
  ).map(item => {
    consumed.add(item.prepositionIndex);
    return contractPreposition(`${item.german} ${renderNominal(context, item.objectIndex, item.germanCase || "dative", consumed)}`);
  });
  const remaining = clause.tokenIndexes.filter(index => !consumed.has(index) && !isStructural(context.words[index]))
    .map(index => renderLooseWord(context, index, consumed));
  return [...subjects, ...prepositional, ...remaining].filter(Boolean).join(" ");
}

function renderNonFinitePurpose(context, clause, options, construction) {
  const nonFiniteIndex = construction.supineIndex ?? construction.gerundIndex ?? construction.participleIndex;
  const objectIndexes = construction.objectIndexes || [];
  const excluded = new Set(options.exclude || []);
  [nonFiniteIndex, construction.markerIndex, construction.prepositionIndex, construction.nounIndex, ...objectIndexes]
    .filter(index => index != null)
    .forEach(index => excluded.add(index));
  const mainText = renderClause(context, clause, { ...options, exclude: excluded, skipNonFinitePurpose: true });
  const consumed = new Set();
  const objects = objectIndexes.map(index => renderNominal(context, index, "accusative", consumed));
  const infinitive = germanZuInfinitive(germanInfinitive(context.words[nonFiniteIndex]));
  return `${mainText}, um ${[...objects, infinitive].filter(Boolean).join(" ")}`;
}

function renderAci(context, construction) {
  const { words } = context;
  const mainClause = context.semantics.clauses.find(clause => clause.tokenIndexes.includes(construction.governingIndex)) || context.semantics.clauses[0];
  const excluded = dependentExclusionClosure(context, new Set(
    [construction.subjectIndex, construction.infinitiveIndex, construction.predicateIndex, ...(construction.objectIndexes || [])]
      .filter(index => index != null)
  ));
  const mainText = renderClause(context, mainClause, { exclude: excluded, narrative: true });
  const mainSubject = mainClause.roles.subject[0] != null ? words[mainClause.roles.subject[0]] : null;
  const embeddedSubject = ["se", "sese"].includes(words[construction.subjectIndex]?.normalized)
    ? reflexiveAciSubject(mainSubject)
    : renderNominal(context, construction.subjectIndex, "nominative", new Set(), { definite: true });
  const objects = (construction.objectIndexes || []).map(index => renderNominal(context, index, "accusative", new Set()));
  const predicateNominal = construction.predicateIndex != null
    ? renderNominal(context, construction.predicateIndex, "nominative", new Set(), { indefinite: true })
    : "";
  const infinitive = words[construction.infinitiveIndex];
  const passiveParticiple = words.find(word => partOf(word) === "ppa" && word.morphology.tense === "perfect" && word.index < infinitive.index && agreementCompatible(word.morphology, words[construction.subjectIndex]?.morphology));
  let embeddedVerb;
  if (passiveParticiple && isEsse(infinitive)) {
    embeddedVerb = `${pastParticiple(germanInfinitive(passiveParticiple))} worden ${infinitive.morphology.tense === "perfect" ? "war" : "ist"}`;
  } else {
    embeddedVerb = renderInfinitiveAsFinite(
      infinitive,
      { person: 3, number: words[construction.subjectIndex]?.morphology.number || "singular" },
      words[construction.governingIndex],
      { subordinate: true }
    );
  }
  return `${mainText}, dass ${[embeddedSubject, ...objects, predicateNominal, embeddedVerb].filter(Boolean).join(" ")}`;
}

function renderNci(context, construction) {
  const { words } = context;
  const subjectIndex = construction.subjectIndex ?? context.semantics.clauses[0]?.roles.subject[0];
  const subject = subjectIndex != null ? renderNominal(context, subjectIndex, "nominative", new Set()) : "man";
  const infinitive = words[construction.infinitiveIndex];
  const objects = context.semantics.clauses.flatMap(clause => clause.roles.directObject).filter(index => index !== subjectIndex).map(index => renderNominal(context, index, "accusative", new Set()));
  const lexical = germanInfinitive(infinitive);
  // The reporting modal "sollen" governs a bare infinitive. In the perfect
  // this becomes an Ersatzinfinitiv group ("erobert haben"), never "zu haben".
  const complement = infinitive.morphology.tense === "perfect" ? `${pastParticiple(lexical)} haben` : lexical;
  return [subject, conjugateGerman("sollen", { person: 3, number: words[subjectIndex]?.morphology.number || "singular" }, "present"), ...objects, complement].filter(Boolean).join(" ");
}

function renderInfinitiveCommand(context, construction) {
  const { words } = context;
  const mainClause = context.semantics.clauses.find(clause => clause.tokenIndexes.includes(construction.governingIndex)) || context.semantics.clauses[0];
  const excluded = new Set([construction.subjectIndex, construction.infinitiveIndex, ...(construction.objectIndexes || [])]);
  const mainText = renderClause(context, mainClause, { exclude: excluded, narrative: true });
  const commanded = renderNominal(context, construction.subjectIndex, "dative", new Set());
  const objects = (construction.objectIndexes || []).map(index => renderNominal(context, index, "accusative", new Set(), { indefinite: true }));
  const infinitive = germanInfinitive(words[construction.infinitiveIndex]);
  return `${mainText} ${commanded}, ${[...objects, `zu ${infinitive}`].filter(Boolean).join(" ")}`;
}

function renderGerundiveObligation(context, construction) {
  const { words } = context;
  const subjectIndex = construction.subjectIndex ?? context.semantics.clauses[0]?.roles.subject[0];
  const subject = subjectIndex != null ? renderNominal(context, subjectIndex, "nominative", new Set()) : "es";
  const clause = context.semantics.clauses.find(item => item.tokenIndexes.includes(construction.participleIndex)) || context.semantics.clauses[0];
  const adverbs = renderAdverbials(context, clause?.roles.adverbial || [], new Set());
  const agentIndex = context.semantics.clauses.flatMap(clause => clause.roles.indirectObject).find(index => index !== subjectIndex);
  const lexical = germanInfinitive(words[construction.participleIndex]);
  if (agentIndex != null) {
    const agent = renderNominal(context, agentIndex, "nominative", new Set());
    const object = subjectIndex != null ? renderNominal(context, subjectIndex, "accusative", new Set()) : "es";
    const agentAgreement = { person: 3, number: words[agentIndex]?.morphology.number || "singular" };
    return `${agent} ${conjugateGerman("müssen", agentAgreement, "present")} ${object} ${lexical}`;
  }
  const agreement = { person: 3, number: words[subjectIndex]?.morphology.number || "singular" };
  if (construction.impersonal || subjectIndex == null) return `${[...adverbs, conjugateGerman("müssen", agreement, "present"), pastParticiple(lexical), "werden"].filter(Boolean).join(" ")}`;
  return `${subject} ${conjugateGerman("müssen", agreement, "present")} ${pastParticiple(lexical)} werden`;
}

function renderWithAblativeAbsolute(context, construction) {
  const { words } = context;
  const subject = renderNominal(context, construction.subjectIndex, "nominative", new Set());
  const participle = words[construction.participleIndex];
  const agreement = { person: 3, number: words[construction.subjectIndex]?.morphology.number || "singular" };
  const lexical = germanInfinitive(participle);
  const complement = findParticipleInfinitiveComplement(context, construction);
  const internalIndexes = ablativeAbsoluteIndexes(context, construction, complement);
  const adverbs = renderAdverbials(context, [...internalIndexes].filter(index => isAdverb(words[index])), new Set());
  let predicate;
  if (construction.temporalRelation === "anterior") {
    const passive = participle.morphology.voice === "passive" && !isLexicallyActiveParticiple(participle);
    if (passive) predicate = `${pastParticiple(lexical)} worden ${conjugateGerman("sein", agreement, "imperfect")}`;
    else {
      const auxiliary = movementVerb(lexical) || lexical === "sein" ? "sein" : "haben";
      predicate = `${pastParticiple(lexical)} ${conjugateGerman(auxiliary, agreement, "imperfect")}`;
    }
  } else if (complement) {
    const argumentsText = renderInfinitiveArguments(context, complement, internalIndexes);
    const governing = preferredGermanController(participle);
    const infinitive = germanInfinitive(complement.infinitive);
    const infinitivePhrase = isGermanModal(governing) ? infinitive : germanZuInfinitive(infinitive);
    predicate = [argumentsText, infinitivePhrase, conjugateGerman(governing || lexical, agreement, "present")].filter(Boolean).join(" ");
  } else {
    predicate = conjugateGerman(lexical, agreement, "present");
  }
  const subordinate = `${construction.temporalRelation === "anterior" ? "Nachdem" : "Während"} ${subject} ${[...adverbs, predicate].filter(Boolean).join(" ")}`.replace(/\s+/g, " ");
  const excluded = internalIndexes;
  const main = context.semantics.clauses.find(clause => clause.roles.subject.some(index => !excluded.has(index)) && clause.headIndex != null && isFinite(words[clause.headIndex]));
  if (!main) return subordinate;
  const mainText = renderClause(context, main, { inverted: true, exclude: excluded, narrative: true });
  return `${subordinate}, ${lowerFirst(mainText)}`;
}

function findParticipleInfinitiveComplement(context, construction) {
  const participleIndex = construction.participleIndex;
  const subjectIndex = construction.subjectIndex ?? construction.antecedentIndex;
  if (participleIndex == null) return null;
  const lower = Math.min(subjectIndex ?? participleIndex, participleIndex);
  const upper = Math.max(subjectIndex ?? participleIndex, participleIndex);
  let candidates = context.words.filter(word => word.morphology?.mood === "infinitive" && word.index >= lower && word.index <= upper);
  if (!candidates.length && !context.words.some(isFinite)) {
    candidates = context.words.filter(word => word.morphology?.mood === "infinitive" && Math.abs(word.index - participleIndex) <= 6);
  }
  const infinitive = candidates.sort((left, right) => Math.abs(left.index - participleIndex) - Math.abs(right.index - participleIndex))[0];
  if (!infinitive) return null;
  const spanStart = Math.min(subjectIndex ?? infinitive.index, infinitive.index, participleIndex);
  const spanEnd = Math.max(subjectIndex ?? infinitive.index, infinitive.index, participleIndex);
  const argumentIndexes = context.words
    .filter(word => word.index >= spanStart && word.index <= spanEnd && word.index !== subjectIndex && word.index !== infinitive.index && word.index !== participleIndex && isNominal(word))
    .map(word => word.index);
  return { infinitive, argumentIndexes };
}

function ablativeAbsoluteIndexes(context, construction, complement) {
  const indexes = new Set([construction.subjectIndex, construction.participleIndex]);
  const lower = Math.min(construction.subjectIndex, construction.participleIndex);
  const upper = Math.max(construction.subjectIndex, construction.participleIndex);
  for (const word of context.words) {
    if (word.index >= lower && word.index <= upper && isAdverb(word)) indexes.add(word.index);
  }
  if (complement) {
    indexes.add(complement.infinitive.index);
    complement.argumentIndexes.forEach(index => indexes.add(index));
  }
  return indexes;
}

function renderInfinitiveArguments(context, complement) {
  const consumed = new Set();
  return complement.argumentIndexes.map(index => {
    const word = context.words[index];
    const grammaticalCase = caseIncludes(word.morphology, "dative") ? "dative"
      : caseIncludes(word.morphology, "genitive") ? "genitive"
        : caseIncludes(word.morphology, "ablative") ? "dative"
          : "accusative";
    return renderNominal(context, index, grammaticalCase, consumed);
  }).filter(Boolean).join(" ");
}

function isGermanModal(value) {
  return new Set(["dürfen", "können", "mögen", "müssen", "sollen", "wollen"]).has(String(value || "").trim());
}

function preferredGermanController(word) {
  const alternatives = germanAlternatives(word);
  return alternatives.find(isGermanModal) || alternatives[0] || germanInfinitive(word);
}

function germanZuInfinitive(infinitive) {
  const value = String(infinitive || "").trim();
  if (!value) return "";
  const reflexive = value.startsWith("sich ");
  const verb = reflexive ? value.slice(5) : value;
  const separable = separableVerb(verb);
  const result = separable ? `${separable.prefix}zu${separable.core}` : `zu ${verb}`;
  return reflexive ? `sich ${result}` : result;
}

function isLexicallyActiveParticiple(word) {
  return Boolean(word?.morphology?.deponent || word?.morphology?.semideponent || word?.morphology?.lexicalVoice === "deponent" || word?.morphology?.verbClass === "deponent");
}

function renderParticipialSentence(context, construction) {
  const { words } = context;
  const clause = context.semantics.clauses.find(item => item.tokenIndexes.includes(construction.participleIndex)) || context.semantics.clauses[0];
  const antecedentIndex = construction.antecedentIndex ?? clause.roles.subject[0];
  if (antecedentIndex == null) return renderClause(context, clause, {});
  const subject = renderNominal(context, antecedentIndex, "nominative", new Set());
  const participle = words[construction.participleIndex];
  const agreement = { person: 3, number: words[antecedentIndex].morphology.number || "singular" };
  const complement = findParticipleInfinitiveComplement(context, construction);
  const complementArgumentsSet = new Set(complement?.argumentIndexes || []);
  const participleObjects = clause.roles.directObject.filter(index => index !== antecedentIndex && !complementArgumentsSet.has(index) && Math.abs(index - participle.index) <= 3);
  const objectText = participleObjects.map(index => renderNominal(context, index, "accusative", new Set())).join(" ");
  const relatedPrepositions = clause.roles.prepositional.filter(item => item.prepositionIndex < participle.index && participle.index - item.objectIndex <= 2);
  const prepositionalText = relatedPrepositions.map(item => contractPreposition(`${item.german} ${renderNominal(context, item.objectIndex, item.germanCase, new Set())}`));
  const complementArguments = complement ? renderInfinitiveArguments(context, complement, new Set(clause.tokenIndexes)) : "";
  const participleController = preferredGermanController(participle);
  const participleVerb = complement
    ? [complementArguments, isGermanModal(participleController) ? germanInfinitive(complement.infinitive) : germanZuInfinitive(germanInfinitive(complement.infinitive)), conjugateGerman(participleController, agreement, "present")].filter(Boolean).join(" ")
    : participle.morphology.tense === "perfect" && participle.morphology.voice === "passive"
    ? `${pastParticiple(germanInfinitive(participle))} wurde`
    : participle.morphology.tense === "perfect"
      ? `${pastParticiple(germanInfinitive(participle))} hat`
    : conjugateGerman(germanInfinitive(participle), agreement, "present");
  const relativePronoun = relativePronounFor(words[antecedentIndex], "nominative");
  const relative = `${relativePronoun} ${[...prepositionalText, objectText, participleVerb].filter(Boolean).join(" ")}`;
  const excluded = new Set([antecedentIndex, construction.participleIndex, ...participleObjects, ...relatedPrepositions.flatMap(item => [item.prepositionIndex, item.objectIndex]), ...(complement ? [complement.infinitive.index, ...complement.argumentIndexes] : [])]);
  const mainText = renderClause(context, clause, { exclude: excluded, omitSubject: true });
  return `${subject}, ${relative}, ${lowerFirst(mainText)}`;
}

function renderRelativeSentence(context, construction) {
  const { words } = context;
  const relativeClause = context.semantics.clauses.find(clause => clause.id === construction.clauseId || clause.type === "relative");
  const mainClause = context.semantics.clauses.find(clause => clause.type === "main");
  if (!relativeClause || !mainClause) return renderClauseComplex(context);
  const antecedentIndex = construction.antecedentIndex;
  const antecedent = words[antecedentIndex];
  const mainSubject = mainClause.roles.subject.includes(antecedentIndex);
  const antecedentText = renderNominal(context, antecedentIndex, mainSubject ? "nominative" : "accusative", new Set());
  const markerIndex = relativeClause.markerIndex;
  const markerCase = firstCase(words[markerIndex]?.morphology) || "nominative";
  const marker = relativePronounFor(antecedent, markerCase);
  const relativeText = renderClause(context, relativeClause, { subordinate: true, omitMarker: true, omitSubject: markerCase === "nominative" });
  const relativeBody = markerCase === "nominative" ? `${marker} ${relativeText}` : `${marker} ${relativeText}`;
  const excluded = new Set([antecedentIndex]);
  const mainRest = renderClause(context, mainClause, { exclude: excluded, omitSubject: mainSubject });
  return mainSubject
    ? `${antecedentText}, ${relativeBody}, ${lowerFirst(mainRest)}`
    : `${mainRest} ${antecedentText}, ${relativeBody}`;
}

function renderFreeRelative(context, construction) {
  const dependent = context.semantics.clauses.find(clause => clause.id === construction.clauseId || clause.type === "free-relative");
  const main = context.semantics.clauses.find(clause => clause.type === "main");
  if (!dependent || !main) return renderClauseComplex(context);
  const markerWord = context.words[dependent.markerIndex];
  const markerCase = firstCase(markerWord?.morphology) || "nominative";
  const marker = ["quod", "quid"].includes(markerWord?.normalized)
    ? (markerCase === "nominative" ? "was" : "was")
    : ({ nominative: "wer", accusative: "wen", dative: "wem", genitive: "wessen", ablative: "wem" })[markerCase] || "wer";
  const dependentText = renderClause(context, dependent, { subordinate: true, omitMarker: true, omitSubject: markerCase === "nominative" });
  const mainHasSubject = main.roles.subject.length > 0;
  const mainText = renderClause(context, main, { inverted: mainHasSubject, omitSubject: !mainHasSubject });
  return `${capitalize(marker)} ${lowerFirst(dependentText)}, ${lowerFirst(mainText)}`;
}

function renderDirectQuestion(context) {
  const clause = context.semantics.clauses[0];
  const marker = context.words.find(word => INTERROGATIVE_FORMS.has(word.normalized));
  if (!clause || !marker) return renderClause(context, clause, {});
  const expression = context.semantics.constructions?.find(item =>
    item.type === "expression" && item.kind === "interrogative" && item.indexes.includes(marker.index)
  );
  const grammaticalCase = firstCase(marker.morphology) || (clause.roles.subject.includes(marker.index) ? "nominative" : "accusative");
  const caseForms = { nominative: "wer", accusative: "wen", dative: "wem", genitive: "wessen", ablative: "womit" };
  const fixed = {
    cur: "warum", quare: "warum", quando: "wann", ubi: "wo", unde: "woher", quo: "wohin",
    quomodo: "wie", quid: "was", quod: "was", quem: "wen", cui: "wem", cuius: "wessen",
    quos: "wen", quas: "wen", num: "ob", utrum: "ob"
  };
  const questionWord = expression?.german || fixed[marker.normalized]
    || (["quis", "qui", "quae"].includes(marker.normalized) ? caseForms[grammaticalCase] || "wer" : renderPronoun(marker, grammaticalCase));
  const asksForSubject = clause.roles.subject.includes(marker.index) || grammaticalCase === "nominative" && partOf(marker) === "pron";
  const vocativeIndexes = clause.roles.vocative || [];
  const excluded = new Set([marker.index, ...(expression?.indexes || []), ...vocativeIndexes]);
  const body = renderClause(context, clause, {
    exclude: excluded,
    omitSubject: asksForSubject,
    inverted: !asksForSubject
  });
  const vocative = vocativeIndexes.map(index => renderNominal(context, index, "nominative", new Set(), { articlelessProper: true })).filter(Boolean).join(" und ");
  return `${capitalize(questionWord)}${vocative ? `, ${vocative},` : ""} ${lowerFirst(body)}`;
}

function renderPartitiveGenitive(context, construction, consumed) {
  const indexes = (construction.memberIndexes || []).filter(index => !consumed.has(index));
  if (!indexes.length) return "";
  indexes.forEach(index => consumed.add(index));
  const demonstrative = indexes.map(index => context.words[index]).find(word => ["hic", "ille", "iste", "is"].includes(word.lemma));
  const universal = indexes.map(index => context.words[index]).find(word => ["omnis", "omne", "totus"].includes(word.lemma));
  if (demonstrative && universal) return `von all ${renderAdjectivalDeterminer(demonstrative, "dative", demonstrative.morphology?.gender || "m", demonstrative.morphology?.number || "plural")}`;
  if (universal) return universal.morphology?.number === "plural" ? "von allen" : "von allem";
  const phrases = indexes.filter(index => isNominal(context.words[index])).map(index => renderNominal(context, index, "dative", new Set()));
  return phrases.length ? `von ${joinGerman(phrases, "und")}` : "";
}

function renderIndirectQuestion(context) {
  const { words } = context;
  let dependent = context.semantics.clauses.find(clause => clause.type === "indirect-question");
  let main = context.semantics.clauses.find(clause => clause.type === "main");
  if (!dependent) {
    const markerIndex = words.findIndex(word => ["cur", "quare", "quando", "ubi", "quid", "quis", "quomodo"].includes(word.normalized));
    const dependentFinite = words.find(word => word.index > markerIndex && isFinite(word));
    const mainFinite = words.find(word => isFinite(word) && word.index < markerIndex);
    if (markerIndex >= 0 && dependentFinite && mainFinite) {
      main = { ...context.semantics.clauses[0], tokenIndexes: context.semantics.clauses[0].tokenIndexes.filter(index => index < markerIndex), headIndex: mainFinite.index };
      dependent = { ...context.semantics.clauses[0], tokenIndexes: range(markerIndex, words.length - 1), headIndex: dependentFinite.index, markerIndex };
    }
  }
  if (!dependent || !main) return renderClause(context, context.semantics.clauses[0], {});
  const mainText = renderClause(context, main, {});
  const marker = cleanClauseMarker(words[dependent.markerIndex]?.sense || words[dependent.markerIndex]?.meaning || renderAdverb(words[dependent.markerIndex]));
  const dependentText = renderClause(context, dependent, { subordinate: true, omitMarker: true });
  return `${mainText}, ${marker || "ob"} ${lowerFirst(dependentText)}`;
}

function renderProhibition(context) {
  const clause = context.semantics.clauses[0];
  const finite = clause.headIndex != null ? context.words[clause.headIndex] : context.words.find(isFinite);
  if (!finite) return renderClause(context, clause, {});
  const agreement = { person: finite.morphology.person || 2, number: finite.morphology.number || "singular" };
  const subject = implicitSubject(agreement);
  const objects = clause.roles.directObject.map(index => renderNominal(context, index, "accusative", new Set()));
  const infinitive = germanInfinitive(finite);
  const reflexive = infinitive.startsWith("sich ");
  const lexical = reflexive ? infinitive.slice(5) : infinitive;
  const reflexivePronoun = reflexive
    ? ({ 1: agreement.number === "plural" ? "uns" : "mich", 2: agreement.number === "plural" ? "euch" : "dich", 3: "sich" })[agreement.person]
    : "";
  return [subject, conjugateGerman("sollen", agreement, "present"), reflexivePronoun, ...objects, "nicht", lexical].filter(Boolean).join(" ");
}

function renderPurposeInfinitive(context, clause) {
  const finite = clause.headIndex != null ? context.words[clause.headIndex] : null;
  const consumed = new Set([clause.markerIndex, finite?.index]);
  const germanCase = VERB_FRAMES[finite?.lemma]?.germanDirectCase || "accusative";
  const objects = clause.roles.directObject.map(index => renderNominal(context, index, germanCase, consumed));
  const prepositional = clause.roles.prepositional.map(item => {
    consumed.add(item.prepositionIndex);
    return contractPreposition(`${item.german} ${renderNominal(context, item.objectIndex, item.germanCase, consumed)}`);
  });
  return [...objects, ...prepositional, `zu ${germanInfinitive(finite)}`].filter(Boolean).join(" ");
}

function renderNominal(context, index, grammaticalCase, consumed = new Set(), options = {}) {
  const word = context.words[index];
  if (!word) return "";
  consumed.add(index);
  const nominalGerunds = context.semantics.constructions?.filter(item =>
    item.type === "gerund" && item.governingNominalIndex === index && !consumed.has(item.gerundIndex)
  ) || [];
  const withGerunds = value => nominalGerunds.reduce((phrase, construction) => {
    const gerund = renderGerundCase(context, construction, consumed);
    return construction.modifierIndexes?.length ? `${phrase}, ${gerund},` : `${phrase} ${gerund}`;
  }, value);
  const dependencyModifiers = context.semantics.dependencies
    ?.filter(dependency => ["attribute", "participle"].includes(dependency.type) && dependency.headIndex === index)
    .map(dependency => dependency.dependentIndex) || [];
  const gerundiveModifiers = context.semantics.constructions
    ?.filter(item => item.type === "gerundive-attributive" && item.nounIndex === index)
    .map(item => item.participleIndex) || [];
  const modifiers = [...new Set([...dependencyModifiers, ...gerundiveModifiers])]
    .filter(modifierIndex => !consumed.has(modifierIndex)
      && (partOf(context.words[modifierIndex]) !== "ppa" || gerundiveModifiers.includes(modifierIndex)));
  modifiers.forEach(modifierIndex => consumed.add(modifierIndex));
  const dependentGenitives = context.semantics.dependencies
    ?.filter(dependency => dependency.type === "genitive-attribute" && dependency.headIndex === index)
    .map(dependency => dependency.dependentIndex)
    .filter(dependentIndex => !consumed.has(dependentIndex)) || [];
  const withDependentGenitives = value => {
    const genitives = dependentGenitives.map(dependentIndex => renderNominal(context, dependentIndex, "genitive", consumed)).filter(Boolean);
    return withGerunds([value, ...genitives].filter(Boolean).join(" "));
  };

  if (partOf(word) === "pron") {
    const universal = modifiers.map(modifierIndex => context.words[modifierIndex]).find(modifier => ["omnis", "omne", "totus"].includes(modifier.lemma));
    if (universal) {
      if (word.morphology?.number === "plural" && grammaticalCase === "nominative") return withGerunds("sie alle");
      const base = renderPronoun(word, grammaticalCase);
      return withGerunds(`${base} ${word.morphology?.number === "plural" ? "alle" : "ganz"}`);
    }
    return withDependentGenitives(renderPronoun(word, grammaticalCase));
  }
  const substantive = SUBSTANTIVIZED_ADJECTIVES[word.lemma];
  if (substantive) {
    const value = word.morphology.number === "plural" ? substantive.plural : substantive.singular;
    return withDependentGenitives(substantive.articleless
      ? value
      : word.morphology.number === "plural"
        ? declineStoredPluralPhrase(value, grammaticalCase)
        : declineNounPhrase(value, grammaticalCase, word, options));
  }

  if (isProper(word)) {
    const name = localizeProperName(word);
    const ethnonym = LATIN_ETHNONYM_LEMMAS.has(word.lemma) && word.morphology?.number === "plural";
    if (!modifiers.length) return withDependentGenitives(ethnonym ? declineProperEthnonym(name, grammaticalCase) : name);
    const universal = modifiers.find(modifierIndex => ["omnis", "totus"].includes(context.words[modifierIndex].lemma));
    if (word.morphology?.number === "plural" && universal != null) return withDependentGenitives(`alle ${name}`);
    const hasArticlelessDeterminer = modifiers.some(modifierIndex => {
      const modifier = context.words[modifierIndex];
      return partOf(modifier) === "num" || isAdjectivalDeterminer(modifier) || Boolean(POSSESSIVE_STEMS[modifier.lemma]);
    });
    const article = word.morphology?.number === "plural" && !hasArticlelessDeterminer
      ? ethnonym && grammaticalCase === "dative" ? "den" : ethnonym && grammaticalCase === "genitive" ? "der" : "die"
      : "";
    const modifierText = modifiers.map(modifierIndex => {
      const modifier = context.words[modifierIndex];
      if (partOf(modifier) === "num") return modifier.sense || firstSense(modifier);
      if (isAdjectivalDeterminer(modifier)) return renderAdjectivalDeterminer(modifier, grammaticalCase, word.morphology?.gender || "m", word.morphology?.number || "singular");
      if (POSSESSIVE_STEMS[modifier.lemma]) return inflectPossessive(POSSESSIVE_STEMS[modifier.lemma], grammaticalCase, word.morphology?.gender || "m", word.morphology?.number || "singular");
      return inflectAdjective(germanAdjectiveDegree(modifier), grammaticalCase, word.morphology?.number === "plural" ? "plural" : word.morphology?.gender || "m", word.morphology?.number || "singular", Boolean(article));
    }).filter(Boolean).join(" ");
    const declinedName = ethnonym && grammaticalCase === "dative" && !/[ns]$/iu.test(name) ? `${name}n` : name;
    return withDependentGenitives([article, modifierText, declinedName].filter(Boolean).join(" "));
  }

  let meaning = cleanNounMeaning(word.sense || word.meaning || firstSense(word) || `[${word.raw}]`);
  let { article, noun, gender } = dissectNoun(meaning, word);
  const number = word.morphology.number || "singular";
  const articlelessModifier = modifiers.some(modifierIndex => {
    const modifier = context.words[modifierIndex];
    return partOf(modifier) === "num" || isAdjectivalDeterminer(modifier) || Boolean(POSSESSIVE_STEMS[modifier.lemma]) || ["aliquot", "multus", "nonnullus", "paucus", "plures", "quot", "tot"].includes(modifier.lemma);
  });
  if (options.indefinite) article = gender === "f" ? "eine" : "ein";
  if (options.definite && !article) article = gender === "f" ? "die" : gender === "n" ? "das" : "der";
  if (articlelessModifier) article = "";
  if (number === "plural") {
    article = articlelessModifier ? "" : grammaticalCase === "dative" ? "den" : grammaticalCase === "genitive" ? "der" : "die";
    noun = germanPlural(noun, gender);
    if (grammaticalCase === "dative" && !noun.endsWith("n") && !noun.endsWith("s")) noun += "n";
    gender = "plural";
  } else {
    article = articlelessModifier ? "" : declineArticle(article || inferArticle(noun, word), grammaticalCase, gender);
    noun = declineGermanNoun(noun, grammaticalCase, gender);
  }
  const adjectiveText = modifiers.map(modifierIndex => {
    if (gerundiveModifiers.includes(modifierIndex)) {
      return inflectAdjective(attributiveGerundiveStem(context.words[modifierIndex]), grammaticalCase, gender, number, Boolean(article));
    }
    const modifier = context.words[modifierIndex];
    if (partOf(modifier) === "num") return modifier.sense || firstSense(modifier);
    if (isAdjectivalDeterminer(modifier)) return renderAdjectivalDeterminer(modifier, grammaticalCase, gender, number);
    if (POSSESSIVE_STEMS[modifier.lemma]) return inflectPossessive(POSSESSIVE_STEMS[modifier.lemma], grammaticalCase, gender, number);
    const stem = ["omnis", "totus"].includes(modifier.lemma) ? "ganz" : germanAdjectiveDegree(modifier);
    return inflectAdjective(stem, grammaticalCase, gender, number, Boolean(article));
  }).join(" ");
  return withDependentGenitives([article, adjectiveText, noun].filter(Boolean).join(" "));
}

function isAdjectivalDeterminer(word) {
  return partOf(word) === "pron" && (
    word.morphology?.adjectivalPronoun
    || ["adjectival", "demonstrative"].includes(word.morphology?.pronounKind)
    || ["hic", "ille", "iste", "ipse", "idem", "is"].includes(word.lemma)
  );
}

function renderAdjectivalDeterminer(word, grammaticalCase, gender, number) {
  const stem = word.lemma === "ille" ? "jen" : word.lemma === "iste" ? "dies" : "dies";
  if (number === "plural") return grammaticalCase === "dative" ? `${stem}en` : grammaticalCase === "genitive" ? `${stem}er` : `${stem}e`;
  const endings = {
    nominative: { m: "er", f: "e", n: "es" },
    accusative: { m: "en", f: "e", n: "es" },
    dative: { m: "em", f: "er", n: "em" },
    genitive: { m: "es", f: "er", n: "es" }
  };
  return `${stem}${endings[grammaticalCase]?.[gender] || "e"}`;
}

function renderSubject(context, indexes, consumed) {
  const appositions = context.semantics.dependencies?.filter(dependency =>
    dependency.type === "apposition"
    && indexes.includes(dependency.headIndex)
    && indexes.includes(dependency.dependentIndex)
  ) || [];
  const appositiveIndexes = new Set(appositions.map(dependency => dependency.dependentIndex));
  const groups = indexes.filter(index => !appositiveIndexes.has(index)).map(index => {
    const head = renderNominal(context, index, "nominative", consumed);
    const apposition = appositions.find(dependency => dependency.headIndex === index);
    if (!apposition) return head;
    const dependent = renderNominal(context, apposition.dependentIndex, "nominative", consumed);
    return `${head}, ${dependent},`;
  }).filter(Boolean);
  if (groups.length <= 1) return groups[0] || "";
  const appositionGroup = groups.find(group => group.endsWith(","));
  if (appositionGroup) {
    const rest = groups.filter(group => group !== appositionGroup);
    return `${appositionGroup} sowie ${joinGerman(rest, "und")}`;
  }
  return joinGerman(groups, "und");
}

function renderLooseWord(context, index, consumed) {
  const word = context.words[index];
  if (!word || consumed.has(index)) return "";
  consumed.add(index);
  if (caseIncludes(word.morphology, "locative")) {
    if (LATIN_LOCATIVES[word.lemma]) return LATIN_LOCATIVES[word.lemma];
    if (isProper(word)) return `in ${localizeProperName(word)}`;
    return contractPreposition(`in ${renderNominal(context, index, "dative", new Set())}`);
  }
  const gerund = context.semantics.constructions?.find(item => item.type === "gerund" && item.gerundIndex === index);
  if (gerund) return renderGerundCase(context, gerund, consumed);
  if (isNominal(word)) return renderNominal(context, index, firstCase(word.morphology) || "nominative", consumed);
  if (isAdverb(word)) return renderAdverb(word);
  if (partOf(word) === "adj") return adjectiveStem(word.sense || firstSense(word));
  if (partOf(word) === "ppa") return pastParticiple(germanInfinitive(word));
  if (word.sense) return word.sense;
  return `[${word.raw}]`;
}

function renderGerundCase(context, construction, consumed = new Set()) {
  const word = context.words[construction.gerundIndex];
  if (!word) return "";
  consumed.add(construction.gerundIndex);
  if (construction.markerIndex != null) consumed.add(construction.markerIndex);
  if (construction.prepositionIndex != null) consumed.add(construction.prepositionIndex);
  const modifiers = (construction.modifierIndexes || []).map(index => {
    consumed.add(index);
    return renderAdverb(context.words[index]);
  }).filter(Boolean);
  const noun = nominalizedInfinitive(germanInfinitive(word));
  const grammaticalCase = construction.grammaticalCase || firstCase(word.morphology);
  const latinPreposition = context.words[construction.prepositionIndex]?.normalized;
  const preposition = LATIN_PREPOSITIONS[latinPreposition];
  if (preposition) {
    if (latinPreposition === "ad") return `zum ${noun}`;
    if (latinPreposition === "in" && grammaticalCase === "ablative") return `beim ${noun}`;
    const germanCase = preposition.germanCaseByLatin?.[grammaticalCase] || preposition.germanCase || "dative";
    const article = germanCase === "genitive" ? "des" : germanCase === "accusative" ? "das" : "dem";
    return contractPreposition(`${preposition.german} ${article} ${germanCase === "genitive" ? `${noun}s` : noun}`);
  }
  if (grammaticalCase === "genitive" && modifiers.length) return `${modifiers.join(" ")} ${germanZuInfinitive(germanInfinitive(word))}`;
  if (grammaticalCase === "genitive") return `des ${noun}s`;
  if (grammaticalCase === "dative") return `zum ${noun}`;
  if (grammaticalCase === "accusative") return `das ${noun}`;
  return `durch das ${noun}`;
}

function nominalizedInfinitive(value) {
  const infinitive = String(value || "").replace(/^sich\s+/, "").trim();
  return capitalize(infinitive || "Tun");
}

function renderSubstantivizedParticiple(word, grammaticalCase = "nominative") {
  const infinitive = germanInfinitive(word).replace(/^sich\s+/, "");
  const stem = infinitive.endsWith("en") ? infinitive.slice(0, -2) : infinitive.endsWith("n") ? infinitive.slice(0, -1) : infinitive;
  const number = word?.morphology?.number || "singular";
  if (number === "plural") {
    const article = grammaticalCase === "dative" ? "den" : grammaticalCase === "genitive" ? "der" : "die";
    return `${article} ${capitalize(`${stem}enden`)}`;
  }
  const gender = word?.morphology?.gender === "f" ? "f" : "m";
  const article = declineArticle(gender === "f" ? "die" : "der", grammaticalCase, gender);
  const ending = article === "der" || article === "die" && grammaticalCase === "nominative" ? "ende" : "enden";
  return `${article} ${capitalize(`${stem}${ending}`)}`;
}

function attributiveGerundiveStem(word) {
  const phrase = germanZuInfinitive(germanInfinitive(word));
  if (!phrase) return "";
  const parts = phrase.split(/\s+/);
  const verb = parts.pop() || "";
  const stem = verb.endsWith("en") ? verb.slice(0, -2) : verb.endsWith("n") ? verb.slice(0, -1) : verb;
  return [...parts, `${stem}end`].filter(Boolean).join(" ");
}

function renderLexicalSequence(context, indexes) {
  const consumed = new Set();
  return indexes.map(index => renderLooseWord(context, index, consumed)).filter(Boolean).join(" ");
}

function renderFiniteVerb(context, word, agreement, options = {}) {
  const infinitive = germanInfinitive(word);
  if (!infinitive) return `[${word.raw}]`;
  const morphology = word.morphology || {};
  const deponent = morphology.deponent || morphology.verbClass === "deponent" || morphology.voice === "passive" && morphology.lexicalVoice === "deponent";
  if (morphology.voice === "passive" && !deponent) {
    if (morphology.tense === "future" || morphology.tense === "future-perfect") return `${conjugateGerman("werden", agreement, "present")} ${pastParticiple(infinitive)} werden`;
    const tense = morphology.tense === "present" ? "present" : "imperfect";
    return `${conjugateGerman("werden", agreement, tense)} ${pastParticiple(infinitive)}`;
  }
  if (morphology.mood === "imperative") return imperativeGerman(infinitive, agreement);
  if (options.counterfactual && morphology.mood === "subjunctive" && morphology.tense === "pluperfect") {
    const auxiliary = movementVerb(infinitive) || infinitive === "sein" ? "sein" : "haben";
    return `${subjunctiveAuxiliary(auxiliary, agreement)} ${pastParticiple(infinitive)}`;
  }
  if (options.counterfactual && morphology.mood === "subjunctive" && isEsse(word) && morphology.tense === "imperfect") return subjunctiveAuxiliary("sein", agreement, false);
  const tense = germanTense(morphology, options.narrative);
  if (morphology.tense === "perfect" && tense === "perfect") {
    const auxiliary = movementVerb(infinitive) ? "sein" : "haben";
    return `${conjugateGerman(auxiliary, agreement, "present")} ${pastParticiple(infinitive)}`;
  }
  if (morphology.tense === "pluperfect") {
    const auxiliary = movementVerb(infinitive) ? "sein" : "haben";
    return `${conjugateGerman(auxiliary, agreement, "imperfect")} ${pastParticiple(infinitive)}`;
  }
  if (morphology.tense === "future" || morphology.tense === "future-perfect") return `${conjugateGerman("werden", agreement, "present")} ${infinitive}`;
  return conjugateGerman(infinitive, agreement, tense);
}

function renderPerfectPassiveVerb(context, participle, auxiliary, agreement) {
  const lexical = germanInfinitive(participle);
  if (isLexicallyActiveParticiple(participle)) {
    const auxiliaryTense = auxiliary.morphology.tense === "present" ? "present" : "imperfect";
    return `${conjugateGerman(movementVerb(lexical) ? "sein" : "haben", agreement, auxiliaryTense)} ${pastParticiple(lexical)}`;
  }
  const tense = auxiliary.morphology.tense === "present" ? "imperfect" : "pluperfect";
  if (tense === "pluperfect") return `${conjugateGerman("sein", agreement, "imperfect")} ${pastParticiple(lexical)} worden`;
  return `${conjugateGerman("werden", agreement, "imperfect")} ${pastParticiple(lexical)}`;
}

function renderInfinitiveAsFinite(infinitive, agreement, governing, options = {}) {
  const lexical = germanInfinitive(infinitive);
  if (infinitive.morphology.voice === "passive") {
    if (infinitive.morphology.tense === "perfect") return `${pastParticiple(lexical)} worden war`;
    return `${pastParticiple(lexical)} wird`;
  }
  if (infinitive.morphology.tense === "perfect") {
    const auxiliary = movementVerb(lexical) ? "sein" : "haben";
    const past = ["perfect", "imperfect", "pluperfect"].includes(governing?.morphology?.tense);
    return `${pastParticiple(lexical)} ${conjugateGerman(auxiliary, agreement, past ? "imperfect" : "present")}`;
  }
  if (infinitive.morphology.tense === "future") return `${conjugateGerman("werden", agreement, "present")} ${lexical}`;
  const past = ["perfect", "imperfect", "pluperfect"].includes(governing?.morphology?.tense);
  const finite = conjugateGerman(lexical, agreement, past ? "imperfect" : "present");
  return options.subordinate ? subordinateFinitePhrase(finite) : finite;
}

function subordinateFinitePhrase(value) {
  const verb = splitGermanVerb(value);
  if (!verb.head) return value;
  if (verb.separable && verb.tail) return [verb.middle, `${verb.tail}${verb.head}`].filter(Boolean).join(" ");
  return [verb.middle, verb.tail, verb.head].filter(Boolean).join(" ");
}

function findPerfectPassive(context, finite, allowed) {
  if (!isEsse(finite)) return null;
  return context.words.find(word => allowed.has(word.index) && partOf(word) === "ppa" && word.morphology.tense === "perfect" && word.morphology.voice === "passive");
}

function germanInfinitive(word) {
  let value = String(word?.sense || word?.meaning || firstSense(word) || "").trim();
  value = value
    .replace(/^\|+/g, "")
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^(?:jdn\.?|jdm\.?|jemanden|jemandem|etw\.?|etwas)\s+/i, "")
    .trim();
  const alternatives = value.split(/\s*[,/;]\s*/).map(item => item.trim()).filter(Boolean);
  return alternatives.find(item => /(?:en|n)$/.test(item.replace(/^sich\s+/, ""))) || alternatives[0] || "";
}

function germanAlternatives(word) {
  const values = [
    word?.sense,
    word?.meaning,
    word?.entry?.deutsch,
    ...(word?.entry?.meanings || []),
    ...(word?.entries || []).flatMap(entry => [entry?.deutsch, ...(entry?.meanings || [])])
  ];
  return [...new Set(values.flatMap(value => String(value || "")
    .replace(/^\([^)]*\)\s*/, "")
    .split(/\s*[,/;]\s*/)
    .map(item => item.trim())
    .filter(Boolean)))];
}

export function conjugateGerman(infinitive, agreement = {}, tense = "present") {
  let verb = String(infinitive || "").trim();
  if (!verb) return "";
  const reflexive = verb.startsWith("sich ");
  if (reflexive) verb = verb.slice(5);
  const phraseWords = verb.split(/\s+/);
  const head = phraseWords.pop();
  const prefixWords = phraseWords.join(" ");
  const separable = separableVerb(head);
  const core = separable ? separable.core : head;
  const person = Math.min(3, Math.max(1, Number(agreement.person) || 3));
  const plural = agreement.number === "plural";
  const table = tense === "imperfect" ? GERMAN_IRREGULAR_PAST[core] : GERMAN_IRREGULAR_PRESENT[core];
  let form;
  if (table) form = table[plural ? 1 : 0][person - 1];
  else if (!/(?:en|n)$/.test(core)) form = core;
  else {
    const stem = core.endsWith("en") ? core.slice(0, -2) : core.slice(0, -1);
    if (tense === "imperfect") {
      const needsE = /[dt]$/.test(stem);
      const suffix = plural
        ? (person === 2 ? (needsE ? "etet" : "tet") : (needsE ? "eten" : "ten"))
        : (person === 2 ? (needsE ? "etest" : "test") : (needsE ? "ete" : "te"));
      form = stem + suffix;
    } else {
      const needsE = /[dt]$/.test(stem);
      const endings = plural
        ? ["en", needsE ? "et" : "t", "en"]
        : ["e", /[sxzß]$/.test(stem) ? "t" : needsE ? "est" : "st", needsE ? "et" : "t"];
      form = stem + endings[person - 1];
    }
  }
  const pronoun = reflexive ? ({ 1: plural ? "uns" : "mich", 2: plural ? "euch" : "dich", 3: "sich" })[person] : "";
  const particle = separable ? separable.prefix : "";
  return [form, pronoun, prefixWords, particle].filter(Boolean).join(" ");
}

export function pastParticiple(infinitive) {
  const verb = String(infinitive || "").replace(/^sich\s+/, "").trim();
  if (GERMAN_PARTICIPLES[verb]) return GERMAN_PARTICIPLES[verb];
  const separable = separableVerb(verb);
  if (separable) return `${separable.prefix}${GERMAN_PARTICIPLES[separable.core] || `ge${regularParticipleCore(separable.core)}`}`;
  if (/^(?:be|emp|ent|er|ge|miss|ver|zer)/.test(verb) || /ieren$/.test(verb)) return verb.replace(/en$/, "t").replace(/n$/, "t");
  return `ge${regularParticipleCore(verb)}`;
}

function regularParticipleCore(verb) {
  const stem = verb.endsWith("en") ? verb.slice(0, -2) : verb.endsWith("n") ? verb.slice(0, -1) : verb;
  return `${stem}${/[dt]$/.test(stem) ? "et" : "t"}`;
}

function germanTense(morphology = {}, narrative = false) {
  if (morphology.tense === "imperfect") return "imperfect";
  if (morphology.tense === "perfect") return narrative ? "imperfect" : "perfect";
  return "present";
}

function verbAgreement(finite, subjectWords = [], options = {}) {
  return {
    person: Number(finite?.morphology?.person) || 3,
    number: options.coordinated ? "plural" : finite?.morphology?.number || (subjectWords.length > 1 ? "plural" : subjectWords[0]?.morphology?.number) || "singular"
  };
}

function implicitSubject(agreement) {
  const person = Number(agreement.person) || 3;
  const plural = agreement.number === "plural";
  return plural ? (["wir", "ihr", "sie"][person - 1] || "sie") : (["ich", "du", "er"][person - 1] || "er");
}

function reflexiveAciSubject(mainSubject) {
  if (!mainSubject) return "er";
  const gender = mainSubject.morphology?.gender;
  if (mainSubject.morphology?.number === "plural") return "sie";
  return gender === "f" ? "sie" : gender === "n" ? "es" : "er";
}

function renderPronoun(word, grammaticalCase) {
  const personal = PERSONAL_PRONOUNS[word.normalized];
  if (personal?.[grammaticalCase]) return personal[grammaticalCase];
  if (RELATIVE_FORMS.has(word.normalized)) return relativePronounFor(word, grammaticalCase);
  if (["hic", "ille", "iste", "ipse", "idem"].includes(word.lemma)) {
    const standalone = {
      hic: "dieser", haec: word.morphology?.number === "plural" ? "diese" : "diese", hoc: "dies",
      hi: "diese", hae: "diese", hunc: "diesen", hanc: "diese", hos: "diese", has: "diese",
      ille: "jener", illa: "jene", illud: "jenes", illum: "jenen", illam: "jene"
    };
    if (standalone[word.normalized]) return standalone[word.normalized];
    return renderAdjectivalDeterminer(word, grammaticalCase, word.morphology?.gender || "m", word.morphology?.number || "singular");
  }
  if (word.lemma === "is") {
    const plural = word.morphology?.number === "plural";
    if (plural) return ({ nominative: "sie", accusative: "sie", dative: "ihnen", genitive: "deren", ablative: "ihnen" })[grammaticalCase] || "sie";
    const gender = word.morphology?.gender || "m";
    return ({
      nominative: { m: "er", f: "sie", n: "es" },
      accusative: { m: "ihn", f: "sie", n: "es" },
      dative: { m: "ihm", f: "ihr", n: "ihm" },
      genitive: { m: "dessen", f: "deren", n: "dessen" },
      ablative: { m: "ihm", f: "ihr", n: "ihm" }
    })[grammaticalCase]?.[gender] || "er";
  }
  const fixed = {
    hic: "dieser", haec: "diese", hoc: "dies", hunc: "diesen", hanc: "diese",
    ille: "jener", illa: "jene", illud: "jenes", is: "er", ea: "sie", id: "es",
    eum: "ihn", eam: "sie", eos: "sie", eas: "sie", omnes: "alle", quis: "wer", quid: "was"
  };
  return fixed[word.normalized] || word.sense || firstSense(word) || `[${word.raw}]`;
}

function relativePronounFor(antecedent, grammaticalCase) {
  const gender = germanGender(antecedent);
  const plural = antecedent?.morphology?.number === "plural";
  if (plural) return ({ nominative: "die", accusative: "die", dative: "denen", genitive: "deren", ablative: "denen" })[grammaticalCase] || "die";
  const forms = {
    nominative: { m: "der", f: "die", n: "das" },
    accusative: { m: "den", f: "die", n: "das" },
    dative: { m: "dem", f: "der", n: "dem" },
    genitive: { m: "dessen", f: "deren", n: "dessen" },
    ablative: { m: "dem", f: "der", n: "dem" }
  };
  return forms[grammaticalCase]?.[gender] || "der";
}

function renderAdverb(word) {
  return DISCOURSE_ADVERBS[word.normalized] || word.sense || word.meaning || firstSense(word) || `[${word.raw}]`;
}

function renderAdverbials(context, indexes, consumed = new Set()) {
  const ordered = [...new Set(indexes)].sort((left, right) => left - right);
  const rendered = [];
  for (let cursor = 0; cursor < ordered.length; cursor += 1) {
    const index = ordered[cursor];
    if (consumed.has(index)) continue;
    const word = context.words[index];
    const nextIndex = ordered[cursor + 1];
    const next = nextIndex == null ? null : context.words[nextIndex];
    const repeatedWithEnclitic = next && next.lemma === word.lemma
      && (next.morphology?.enclitic === "que" || next.enclitics?.includes?.("que"));
    consumed.add(index);
    if (repeatedWithEnclitic) {
      consumed.add(nextIndex);
      cursor += 1;
      rendered.push(renderRepeatedAdverb(renderAdverb(word)));
    } else {
      rendered.push(renderAdverb(word));
    }
  }
  return rendered;
}

function renderRepeatedAdverb(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase("de");
  if (normalized === "wieder" || normalized === "erneut") return "immer wieder";
  if (normalized === "oft" || normalized === "häufig") return "sehr oft";
  return `${value} und nochmals ${value}`;
}

function firstSense(word) {
  return word?.entry?.deutsch || word?.entry?.meanings?.[0] || "";
}

function cleanNounMeaning(value) {
  return String(value || "")
    .split(/\s*;\s*/)[0]
    .split(/\s*,\s*(?=(?:der|die|das|ein|eine)\s+)/i)[0]
    .trim()
    .replace(/^\([^)]*\)\s*/, "");
}

function dissectNoun(meaning, word) {
  const match = meaning.match(/^(der|die|das|ein|eine)\s+(.+)$/i);
  const noun = match?.[2] || meaning;
  const known = KNOWN_GERMAN_NOUNS[noun];
  const article = match?.[1]?.toLocaleLowerCase("de") || known?.article || inferArticle(noun, word);
  const gender = article === "die" || article === "eine" ? "f" : article === "das" ? "n" : "m";
  return { article, noun, gender };
}

function inferArticle(noun, word) {
  const known = KNOWN_GERMAN_NOUNS[noun]?.article;
  if (known) return known;
  const lower = noun.toLocaleLowerCase("de");
  // German lexical endings are stronger evidence than the unrelated gender
  // of the Latin source noun (for example donum n. -> die Gabe).
  if (/(?:chen|lein|ment|um)$/.test(lower)) return "das";
  if (/(?:e|ung|heit|keit|schaft|tät|ion|ik|ie|anz|enz|ur|ei|in)$/.test(lower)) return "die";
  if (word?.morphology?.gender === "n") return "das";
  if (word?.morphology?.gender === "f") return "die";
  return "der";
}

function germanGender(word) {
  if (!word) return "m";
  if (isProper(word)) return word.morphology.gender === "f" ? "f" : word.morphology.gender === "n" ? "n" : "m";
  return dissectNoun(cleanNounMeaning(word.sense || firstSense(word)), word).gender;
}

function declineArticle(article, grammaticalCase, gender) {
  const indefinite = /^ein/.test(article);
  const tables = {
    nominative: { m: indefinite ? "ein" : "der", f: indefinite ? "eine" : "die", n: indefinite ? "ein" : "das" },
    accusative: { m: indefinite ? "einen" : "den", f: indefinite ? "eine" : "die", n: indefinite ? "ein" : "das" },
    dative: { m: indefinite ? "einem" : "dem", f: indefinite ? "einer" : "der", n: indefinite ? "einem" : "dem" },
    genitive: { m: indefinite ? "eines" : "des", f: indefinite ? "einer" : "der", n: indefinite ? "eines" : "des" }
  };
  return tables[grammaticalCase]?.[gender] || article;
}

function declineNounPhrase(phrase, grammaticalCase, word, options = {}) {
  const { article, noun, gender } = dissectNoun(phrase, word);
  const selectedArticle = options.indefinite ? (gender === "f" ? "eine" : "ein") : article;
  return `${declineArticle(selectedArticle, grammaticalCase, gender)} ${declineGermanNoun(noun, grammaticalCase, gender)}`;
}

function declineStoredPluralPhrase(phrase, grammaticalCase) {
  let noun = String(phrase || "").replace(/^(?:die|der|den)\s+/iu, "").trim();
  const article = grammaticalCase === "dative" ? "den" : grammaticalCase === "genitive" ? "der" : "die";
  if (grammaticalCase === "dative" && noun && !/[ns]$/iu.test(noun)) noun += "n";
  return [article, noun].filter(Boolean).join(" ");
}

function declineProperEthnonym(name, grammaticalCase) {
  const article = grammaticalCase === "dative" ? "den" : grammaticalCase === "genitive" ? "der" : "die";
  const noun = grammaticalCase === "dative" && !/[ns]$/iu.test(name) ? `${name}n` : name;
  return `${article} ${noun}`;
}

function declineGermanNoun(noun, grammaticalCase, gender) {
  if (grammaticalCase !== "nominative" && KNOWN_GERMAN_NOUNS[noun]?.oblique) return KNOWN_GERMAN_NOUNS[noun].oblique;
  if (grammaticalCase === "genitive" && ["m", "n"].includes(gender) && !/[sxßz]$/i.test(noun)) return `${noun}s`;
  return noun;
}

function germanPlural(noun, gender) {
  const known = KNOWN_GERMAN_NOUNS[noun]?.plural;
  if (known) return known;
  if (/(?:er|el|en|chen|lein)$/i.test(noun)) return noun;
  if (/e$/i.test(noun)) return `${noun}n`;
  if (/(?:in)$/i.test(noun)) return `${noun}nen`;
  if (gender === "f") return `${noun}en`;
  return `${noun}e`;
}

function adjectiveStem(value) {
  return String(value || "").replace(/^(?:der|die|das)\s+/i, "").replace(/\([^)]*\)/g, "").replace(/e(?:n|m|s)?$/i, "").trim();
}

function germanAdjectiveDegree(word, options = {}) {
  const base = adjectiveStem(word?.sense || word?.meaning || firstSense(word));
  if (word?.morphology?.comparison === "superlative") {
    const stem = GERMAN_ADJECTIVE_SUPERLATIVES[base]
      || `${base}${/[dtsßxz]$/iu.test(base) ? "est" : "st"}`;
    return options.predicate ? `am ${stem}en` : stem;
  }
  if (word?.morphology?.comparison !== "comparative") return base;
  if (GERMAN_ADJECTIVE_COMPARATIVES[base]) return GERMAN_ADJECTIVE_COMPARATIVES[base];
  if (/el$/iu.test(base)) return `${base.slice(0, -2)}ler`;
  if (/er$/iu.test(base)) return `${base.replace(/e(?=r$)/u, "")}er`;
  if (/e$/iu.test(base)) return `${base.slice(0, -1)}er`;
  return `${base}er`;
}

function inflectPossessive(stem, grammaticalCase, gender, number) {
  if (number === "plural") return `${stem}${grammaticalCase === "dative" ? "en" : grammaticalCase === "genitive" ? "er" : "e"}`;
  const endings = {
    nominative: { m: "", f: "e", n: "" },
    accusative: { m: "en", f: "e", n: "" },
    dative: { m: "em", f: "er", n: "em" },
    genitive: { m: "es", f: "er", n: "es" }
  };
  return `${stem}${endings[grammaticalCase]?.[gender] || ""}`;
}

function inflectAdjective(value, grammaticalCase, gender, number, hasArticle) {
  const stem = adjectiveStem(value);
  if (!stem) return "";
  if (!hasArticle) {
    if (number === "plural") return `${stem}e`;
    return `${stem}${gender === "f" ? "e" : gender === "n" ? "es" : "er"}`;
  }
  if (number === "plural" || grammaticalCase === "dative" || grammaticalCase === "genitive" || grammaticalCase === "accusative" && gender === "m") return `${stem}en`;
  return `${stem}e`;
}

function contractPreposition(value) {
  return String(value)
    .replace(/^zu dem\b/i, "zum")
    .replace(/^zu der\b/i, "zur")
    .replace(/^in dem\b/i, "im")
    .replace(/^an dem\b/i, "am")
    .replace(/^von dem\b/i, "vom")
    .replace(/^bei dem\b/i, "beim")
    .replace(/^auf das\b/i, "aufs");
}

function defaultAblativePhrase(word, nominal) {
  if (["annus", "dies", "hora", "nox", "tempus"].includes(word?.lemma)) return contractPreposition(`in ${nominal}`);
  if (isProper(word)) return contractPreposition(`in ${nominal}`);
  return contractPreposition(`mit ${nominal}`);
}

function splitGermanVerb(value) {
  const parts = String(value || "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { head: parts[0] || "", middle: "", tail: "", separable: false };
  const reflexiveIndex = parts.findIndex((part, index) => index > 0 && ["mich", "dich", "sich", "uns", "euch"].includes(part));
  if (reflexiveIndex >= 0) return { head: parts[0], middle: parts[reflexiveIndex], tail: parts.filter((_, index) => index !== 0 && index !== reflexiveIndex).join(" "), separable: false };
  const auxiliaries = new Set(["bin", "bist", "ist", "sind", "seid", "war", "warst", "waren", "wart", "habe", "hast", "hat", "haben", "habt", "hatte", "hattest", "hatten", "hattet", "werde", "wirst", "wird", "werden", "werdet", "wurde", "wurdest", "wurden", "wurdet"]);
  if (auxiliaries.has(parts[0])) return { head: parts[0], middle: "", tail: parts.slice(1).join(" "), separable: false };
  const particles = new Set(["ab", "an", "auf", "aus", "bei", "ein", "fest", "fort", "her", "hin", "los", "mit", "nach", "nieder", "statt", "teil", "vor", "weg", "weiter", "zurück", "zusammen", "zu"]);
  return { head: parts.slice(0, -1).join(" "), middle: "", tail: parts.at(-1), separable: particles.has(parts.at(-1)) };
}

function separableVerb(value) {
  const prefixes = ["ab", "an", "auf", "aus", "bei", "ein", "fest", "fort", "her", "hin", "los", "mit", "nach", "nieder", "statt", "teil", "vor", "weg", "weiter", "zurück", "zusammen", "zu"];
  const prefix = prefixes.find(item => value.startsWith(item) && value.length > item.length + 2);
  return prefix ? { prefix, core: value.slice(prefix.length) } : null;
}

function movementVerb(value) {
  return ["fahren", "fallen", "fliegen", "fliehen", "gehen", "kommen", "laufen", "reisen", "sterben", "wachsen", "weggehen", "fortgehen", "aufbrechen", "zurückkehren", "vergehen"].includes(value);
}

function imperativeGerman(infinitive, agreement) {
  const irregular = {
    geben: ["gib", "gebt"], haben: ["hab", "habt"], lesen: ["lies", "lest"],
    nehmen: ["nimm", "nehmt"], sehen: ["sieh", "seht"], sein: ["sei", "seid"], werden: ["werde", "werdet"]
  };
  if (irregular[infinitive]) return irregular[infinitive][agreement.number === "plural" ? 1 : 0];
  const stem = infinitive.replace(/en$/, "").replace(/n$/, "");
  if (agreement.number === "plural") return `${stem}${/[dt]$/.test(stem) ? "et" : "t"}`;
  return `${stem}${/[dt]$/.test(stem) ? "e" : ""}`;
}

function subjunctiveAuxiliary(auxiliary, agreement, perfect = true) {
  const person = Math.min(3, Math.max(1, Number(agreement.person) || 3));
  const plural = agreement.number === "plural";
  const tables = {
    haben: [["hätte", "hättest", "hätte"], ["hätten", "hättet", "hätten"]],
    sein: [["wäre", "wärst", "wäre"], ["wären", "wärt", "wären"]]
  };
  return tables[auxiliary][plural ? 1 : 0][person - 1];
}

function ablativeAbsoluteAdverbs(context, construction) {
  const start = Math.min(construction.subjectIndex, construction.participleIndex);
  const end = Math.max(construction.subjectIndex, construction.participleIndex);
  return context.words
    .filter(word => word.index >= start && word.index <= end && isAdverb(word) && !NEGATIONS.has(word.normalized))
    .map(renderAdverb);
}

function clauseConjunction(clause, words) {
  if (clause.type === "consecutive") return "dass";
  if (clause.type === "final") return "damit";
  if (clause.type === "negative-final") return "damit nicht";
  if (clause.type === "conditional") return clause.marker === "nisi" ? "wenn nicht" : "wenn";
  if (clause.type === "causal") return "weil";
  if (clause.type === "concessive") return "obwohl";
  if (clause.type === "temporal-anterior") return "nachdem";
  if (clause.type === "temporal") return clause.marker === "dum" ? "während" : "als";
  return SUBORDINATORS[clause.marker] || COORDINATORS[clause.marker] || words[clause.markerIndex]?.sense || "dass";
}

function cleanClauseMarker(value) {
  return String(value || "")
    .split(/\s*[,/;]\s*/)[0]
    .replace(/[.!?:;,]+$/u, "")
    .trim();
}

function sameClauseSubject(main, dependent, words) {
  const mainSubject = main.roles.subject[0];
  const dependentSubject = dependent.roles.subject[0];
  if (dependentSubject == null) {
    const dependentHead = dependent.headIndex != null ? words[dependent.headIndex] : null;
    const controlledObject = main.roles.directObject.find(index => !dependentHead?.morphology?.number || words[index]?.morphology?.number === dependentHead.morphology.number);
    return controlledObject == null;
  }
  if (mainSubject == null) return false;
  return words[mainSubject]?.lemma === words[dependentSubject]?.lemma;
}

function localizeProperName(word) {
  const names = {
    aquitanus: "Aquitanier", belga: "Belgier", carthago: "Karthago", gallia: "Gallien",
    gallus: "Gallier", helvetius: "Helvetier", roma: "Rom", romanus: "Römer", troianus: "Trojaner"
  };
  if (names[word.lemma]) return names[word.lemma];
  const stored = String(word.sense || word.meaning || firstSense(word) || word.raw).replace(/^(?:der|die|das)\s+/i, "");
  const canonical = word.lemma && !["x", "xx", "xxx", "zzz"].includes(word.lemma) && normalizeLatin(stored) !== word.lemma
    ? word.lemma
    : stored;
  return capitalize(canonical);
}

function agreementCompatible(left = {}, right = {}) {
  return (!left.number || !right.number || left.number === right.number) && (!left.gender || !right.gender || ["c", "x"].includes(left.gender) || ["c", "x"].includes(right.gender) || left.gender === right.gender);
}

function isStructural(word) {
  return Boolean(COORDINATORS[word.normalized] || SUBORDINATORS[word.normalized] || LATIN_PREPOSITIONS[word.normalized] || NEGATIONS.has(word.normalized) || word.normalized === "que");
}

function joinGerman(values, conjunction) {
  const items = values.filter(Boolean);
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

function capitalize(value) {
  return value ? value[0].toLocaleUpperCase("de") + value.slice(1) : value;
}

function lowerFirst(value) {
  return value ? value[0].toLocaleLowerCase("de") + value.slice(1) : value;
}

function range(start, end) {
  return end < start ? [] : Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}
