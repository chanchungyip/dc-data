#!/usr/bin/env node

const program = require('commander');
require('dotenv').config();

const { getStr, getInt, log } = require('./lib/importer');
const { loadCandidates, loadPeople, loadConstituencies } = require('./lib/google');
const {
  MUTATION_UPDATE_PERSON,
  MUTATION_UPDATE_CANDIDATE,
  MUTATION_UPDATE_CONSTITUENCY,
} = require('./lib/gql');
const { runQuery } = require('./lib/hasura');

async function updateConstituencies(fromIdStr, toIdStr) {
  const fromId = parseInt(fromIdStr, 10);
  const toId = parseInt(toIdStr, 10);
  if (fromId > toId) {
    log.error('Invalid from_id and to_id');
    return;
  }

  const constituencies = await loadConstituencies(fromId, toId);
  // id	code	district_id	year	name_en	name_zh	expected_population	deviation_percentage	tags	meta_tags	main_areas	boundaries	voters	new_voters	description

  let updateCount = 0;
  for (let i = 0; i < constituencies.length; i += 1) {
    const constituency = constituencies[i];
    const [constituency_id, , , , , , , , tags, meta_tags, , , , , description] = constituency;
    // hasura update
    try {
      const res = await runQuery(MUTATION_UPDATE_CONSTITUENCY, {
        constituencyId: getInt(constituency_id, null),
        updateInput: {
          description,
        },
      });

      if (res.statusCode !== 200 || !res.body.data.update_dcd_constituencies) {
        throw res.body.data;
      }

      updateCount += 1;
    } catch (error) {
      log.error(`error when updating constituency_id :${constituency_id}`);
      console.error(error);
    }
    log.info('batch update completed');
    log.info(`constituencies updated: ${updateCount}/${constituencies.length}`);
  }

}

async function updateCandidate(fromIdStr, toIdStr) {
  const fromId = parseInt(fromIdStr, 10);
  const toId = parseInt(toIdStr, 10);
  if (fromId > toId) {
    log.error('Invalid from_id and to_id');
    return;
  }

  const people = await loadPeople();
  const candidates = await loadCandidates(fromId, toId);
  if (candidates.length === 0 || people.length === 0) {
    log.error('error when loading data from google spreadsheet');
    return;
  }

  let candidatesUpdateCount = 0;
  let peopleUpdateCount = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const [candidate_id, cname_zh, cname_en, , person_id, , , cacode, , , political_affiliation, camp, candidate_number, occupation, nominated_at, nominate_status, , , fb_id, ig_id, tags] = candidate;
    const person = people.find(p => p[0] === person_id);
    if (person === null) {
      log.error(`people not found for candidata_id:${candidate_id} [${cname_zh}]`);
      continue;
    }

    // hasura update
    // update candidate first
    try {
      const res = await runQuery(MUTATION_UPDATE_CANDIDATE, {
        candidateId: getInt(candidate_id, null),
        updateInput: {
          political_affiliation: getStr(political_affiliation, null),
          camp,
          occupation: getStr(occupation, null),
          nominated_at: getStr(nominated_at, null),
          nominate_status: getStr(nominate_status, null),
          candidate_number: getStr(candidate_number, null),
          fb_id: getStr(fb_id, null),
          ig_id: getStr(ig_id, null),
        },
        tags: tags && tags.length > 0 ? tags.split(',').filter(t => t.length > 0).map((entry) => {
          const [type, tag] = entry.split(':');
          return {
            candidate_id: getInt(candidate_id, null), tag, type,
          };
        }) : [],
      });

      if (res.statusCode !== 200 || !res.body.data.update_dcd_candidates) {
        throw res.body.data;
      }

      candidatesUpdateCount += 1;
    } catch (error) {
      log.error(`error when updating candidate_id :${candidate_id}`);
      log.error(error);
    }


    try {
      const [, name_en, name_zh, estimated_yob, gender, related_organization, , fc_uuid, description] = person;
      const res = await runQuery(MUTATION_UPDATE_PERSON, {
        personId: getInt(person_id, null),
        updateInput: {
          name_zh: getStr(name_zh, null),
          name_en: getStr(name_en, null),
          related_organization: getStr(related_organization, null),
          estimated_yob: getInt(estimated_yob, null),
          gender: getStr(gender, null),
          fc_uuid: getStr(fc_uuid, null),
          description: getStr(description, null),
        },
      });

      if (res.statusCode !== 200 || !res.body.data.update_dcd_people) {
        throw res.body.data;
      }

      peopleUpdateCount += 1;
    } catch (error) {
      log.error(`error when updating person. candidate_id: ${candidate_id}, person_id: ${person_id}`);
      log.error(error);
    }

    log.info('batch update completed');
    log.info(`candidates updated: ${candidatesUpdateCount}/${candidates.length}`);
    log.info(`people updated: ${peopleUpdateCount}/${candidates.length}`);
  }


  // loadPersonById
  // id	name_en	name_zh	estimated_yob	gender	related_organization	uuid	fc_uuid	description
}

program
  .version('0.1.0');

program
  .command('candidates <fromId> <toId>')
  .description('update the candidate from master data sheet and import to hasura directly')
  .action(updateCandidate);

program
  .command('constituencies <fromId> <toId>')
  .description('update the candidate from master data sheet and import to hasura directly')
  .action(updateConstituencies);


program.parse(process.argv);

// If no arguments we should output the help
if (!program.args.length) program.help();

