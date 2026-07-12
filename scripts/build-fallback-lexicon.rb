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
  { "lemma" => "attraho", "forms" => ["attraho", "attrahere", "attraxi", "attractum"], "pos" => "v", "meanings" => ["heranziehen", "an sich ziehen"] }
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
