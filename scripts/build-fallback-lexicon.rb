#!/usr/bin/env ruby

require "json"
require "rexml/document"
require "rexml/xpath"

abort "Usage: build-fallback-lexicon.rb SOURCE.tei OUTPUT.json" unless ARGV.length == 2

source_path, output_path = ARGV
document = REXML::Document.new(File.read(source_path, encoding: "UTF-8"))
namespace = { "tei" => "http://www.tei-c.org/ns/1.0" }
entries = {}

clean = lambda do |value|
  value.to_s.gsub(/\s+/, " ").strip
end

REXML::XPath.each(document, "//tei:entry", namespace) do |entry|
  headword = clean.call(REXML::XPath.first(entry, "./tei:form/tei:orth", namespace)&.text)
  next if headword.empty?

  part_of_speech = clean.call(REXML::XPath.first(entry, "./tei:gramGrp/tei:pos", namespace)&.text)
  forms = REXML::XPath.match(entry, "./tei:form//tei:orth", namespace).map { |node| clean.call(node.text) }.reject(&:empty?).uniq
  meanings = REXML::XPath.match(entry, ".//tei:cit[@type='trans']/tei:quote", namespace).map do |node|
    clean.call(REXML::XPath.match(node, ".//text()").map(&:value).join(" "))
  end.reject(&:empty?).uniq
  next if meanings.empty?

  key = [headword.downcase, part_of_speech].join("|")
  target = entries[key] ||= { "lemma" => headword, "forms" => [], "pos" => part_of_speech, "meanings" => [] }
  target["forms"] |= forms
  target["meanings"] |= meanings
end

# Small school-text supplement for common lemmas that are absent from FreeDict 1.0.3.
[
  { "lemma" => "Siren", "forms" => ["Siren", "Sirenis"], "pos" => "n", "meanings" => ["die Sirene"] },
  { "lemma" => "hydra", "forms" => ["hydra", "hydrae"], "pos" => "n", "meanings" => ["die Hydra"] },
  { "lemma" => "philtrum", "forms" => ["philtrum", "philtri"], "pos" => "n", "meanings" => ["der Liebestrank"] },
  { "lemma" => "configo", "forms" => ["configo", "configere", "confixi", "confixum"], "pos" => "v", "meanings" => ["durchbohren", "zusammenheften"] },
  { "lemma" => "attraho", "forms" => ["attraho", "attrahere", "attraxi", "attractum"], "pos" => "v", "meanings" => ["heranziehen", "an sich ziehen"] },
  { "lemma" => "abutor", "forms" => ["abutor", "abuti", "abusum", "abutere"], "pos" => "v", "meanings" => ["missbrauchen", "gebrauchen"] },
  { "lemma" => "adpeto", "forms" => ["adpeto", "adpetere", "adpetivi", "adpetitum", "adpetens"], "pos" => "v", "meanings" => ["anstreben", "begehren"] },
  { "lemma" => "adspiro", "forms" => ["adspiro", "adspirare", "adspiravi", "adspiratum", "adspirate"], "pos" => "v", "meanings" => ["beistehen", "günstig begleiten"] },
  { "lemma" => "algor", "forms" => ["algor", "algoris"], "pos" => "n", "meanings" => ["die Kälte"] },
  { "lemma" => "congero", "forms" => ["congero", "congerere", "congessi", "congestum", "congestus", "congesta"], "pos" => "v", "meanings" => ["anhäufen", "zusammentragen"] },
  { "lemma" => "continenter", "forms" => ["continenter"], "pos" => "adv", "meanings" => ["ununterbrochen"] },
  { "lemma" => "quisquam", "forms" => ["quisquam", "cuiusquam", "cuiquam", "quemquam", "quoquam"], "pos" => "pron", "meanings" => ["irgendjemand", "jemand"] },
  { "lemma" => "qui", "forms" => ["qui", "quae", "quod", "cuius", "cui", "quem", "quam", "quo", "qua", "quos", "quas", "quorum", "quarum", "quibus", "quibuscum"], "pos" => "pron", "meanings" => ["der", "welcher"] },
  { "lemma" => "deus", "forms" => ["deus", "dei", "deo", "deum", "di", "dii", "deorum", "deis", "deos"], "pos" => "n", "meanings" => ["der Gott"] },
  { "lemma" => "effemino", "forms" => ["effemino", "effeminare", "effeminavi", "effeminatum", "effeminandos"], "pos" => "v", "meanings" => ["verweichlichen"] },
  { "lemma" => "effigies", "forms" => ["effigies", "effigiei", "effigiem"], "pos" => "n", "meanings" => ["das Abbild", "das Spiegelbild"] },
  { "lemma" => "effrenatus", "forms" => ["effrenatus", "effrenata", "effrenatum"], "pos" => "adj", "meanings" => ["zügellos", "ungezügelt"] },
  { "lemma" => "elabor", "forms" => ["elabor", "elabi", "elapsum", "elabitur"], "pos" => "v", "meanings" => ["entgleiten", "verstreichen"] },
  { "lemma" => "eludo", "forms" => ["eludo", "eludere", "elusi", "elusum", "eludet"], "pos" => "v", "meanings" => ["verspotten", "täuschen"] },
  { "lemma" => "idem", "forms" => ["idem", "eadem", "idem", "eiusdem", "eidem", "eundem", "eandem", "eodem", "eadem"], "pos" => "pron", "meanings" => ["derselbe", "der gleiche"] },
  { "lemma" => "excido", "forms" => ["excido", "excidere", "excidi", "excidebat"], "pos" => "v", "meanings" => ["entgleiten", "herausfallen"] },
  { "lemma" => "hereditas", "forms" => ["hereditas", "hereditatis", "hereditate"], "pos" => "n", "meanings" => ["das Erbe", "die Erbschaft"] },
  { "lemma" => "indigestus", "forms" => ["indigestus", "indigesta", "indigestum"], "pos" => "adj", "meanings" => ["ungeordnet", "unverarbeitet"] },
  { "lemma" => "infitior", "forms" => ["infitior", "infitiari", "infitiatum", "infitiandum"], "pos" => "v", "meanings" => ["leugnen", "bestreiten"] },
  { "lemma" => "libet", "forms" => ["libet", "lubet", "libuit", "lubuit"], "pos" => "v", "meanings" => ["es gefällt", "es beliebt"] },
  { "lemma" => "munitus", "forms" => ["munitus", "munita", "munitum", "munitissimus"], "pos" => "adj", "meanings" => ["befestigt", "gesichert"] },
  { "lemma" => "nos", "forms" => ["nos", "nostri", "nostrum", "nobis"], "pos" => "pron", "meanings" => ["wir", "uns"] },
  { "lemma" => "o", "forms" => ["o"], "pos" => "interj", "meanings" => ["o"] },
  { "lemma" => "primordium", "forms" => ["primordium", "primordii", "primordio"], "pos" => "n", "meanings" => ["der Anfang", "der Ursprung"] },
  { "lemma" => "rudis", "forms" => ["rudis", "rude"], "pos" => "adj", "meanings" => ["roh", "unbearbeitet"] },
  { "lemma" => "septentrio", "forms" => ["septentrio", "septentrionis", "septentrionem", "septentriones"], "pos" => "n", "meanings" => ["der Norden"] },
  { "lemma" => "se", "forms" => ["se", "sui", "sibi", "sese"], "pos" => "pron", "meanings" => ["sich"] },
  { "lemma" => "subdolus", "forms" => ["subdolus", "subdola", "subdolum"], "pos" => "adj", "meanings" => ["hinterlistig", "arglistig"] },
  { "lemma" => "subripio", "forms" => ["subripio", "subripere", "subripui", "subreptum", "subripiebatur"], "pos" => "v", "meanings" => ["heimlich entreißen", "stehlen"] },
  { "lemma" => "supero", "forms" => ["supero", "superare", "superavi", "superatum", "superarit"], "pos" => "v", "meanings" => ["übertreffen", "besiegen"] },
  { "lemma" => "vergo", "forms" => ["vergo", "vergere", "vergit"], "pos" => "v", "meanings" => ["sich erstrecken", "sich neigen"] },
  { "lemma" => "voltus", "forms" => ["voltus", "voltusque", "vultus"], "pos" => "n", "meanings" => ["das Gesicht", "die Miene"] },
  { "lemma" => "benefactum", "forms" => ["benefactum", "benefacti", "benefacto"], "pos" => "n", "meanings" => ["die Wohltat", "die gute Tat"] },
  { "lemma" => "lacto", "forms" => ["lacto", "lactare", "lactavi", "lactatum", "lactantem"], "pos" => "v", "meanings" => ["säugen", "Milch geben"] },
  { "lemma" => "exanimo", "forms" => ["exanimo", "exanimare", "exanimavi", "exanimatum"], "pos" => "v", "meanings" => ["töten", "das Leben nehmen"] },
  { "lemma" => "obsero", "forms" => ["obsero", "obserere", "obsevi", "obsitum"], "pos" => "v", "meanings" => ["besäen", "bepflanzen"] },
  { "lemma" => "fauces", "forms" => ["fauces", "faucium", "fauce", "faucibus"], "pos" => "n", "meanings" => ["der Rachen", "die Kehle"] },
  { "lemma" => "turbulentus", "forms" => ["turbulentus", "turbulenta", "turbulentum"], "pos" => "adj", "meanings" => ["trüb", "aufgewühlt"] },
  { "lemma" => "hercle", "forms" => ["hercle"], "pos" => "interj", "meanings" => ["beim Herkules", "wahrhaftig"] }
].each do |supplement|
  entries[[supplement["lemma"].downcase, supplement["pos"]].join("|")] = supplement
end

payload = {
  "source" => {
    "name" => "FreeDict Lateinisch-Deutsch",
    "version" => "1.0.3",
    "license" => "GPL-3.0-or-later",
    "url" => "https://freedict.org/"
  },
  "entries" => entries.values.sort_by { |item| [item["lemma"].downcase, item["pos"]] }
}

File.write(output_path, JSON.generate(payload), mode: "w", encoding: "UTF-8")
