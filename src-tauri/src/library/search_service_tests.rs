fn assert_home_membership_context(continue_watching: bool) {
    let fixture = Fixture::new();
    let a = fixture.collection("Z collection");
    let b = fixture.collection("A collection");
    let (first, second) = if a.id < b.id { (&a, &b) } else { (&b, &a) };
    let project = fixture.project("home-member.mp4");
    fixture.add(first, &project, 9, 8, 7);
    fixture.add(second, &project, 1, 2, 0);
    fixture.service.store.connect().unwrap().execute(
        "UPDATE playback_states SET position_ms = 1000 WHERE project_id = ?1", params![project.id],
    ).unwrap();
    let home = fixture.service.get_home().unwrap();
    let rows = if continue_watching { home.continue_watching } else { home.recently_added };
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.collection_id.as_deref(), Some(first.id.as_str()));
    assert_eq!(row.collection_title.as_deref(), Some(first.title.as_str()));
    assert_eq!((row.season_number, row.episode_number, row.absolute_order), (Some(9), Some(8), Some(7)));
}

#[test]
fn recent_media_preserves_one_membership_context() { assert_home_membership_context(false); }

#[test]
fn continue_media_preserves_one_membership_context() { assert_home_membership_context(true); }

#[test]
fn search_keeps_collection_identity_and_episode_context_together() {
    let fixture = Fixture::new();
    let a = fixture.collection("Z collection");
    let b = fixture.collection("A collection");
    let (first, second) = if a.id < b.id { (&a, &b) } else { (&b, &a) };
    let project = fixture.project("shared-search.mp4");
    fixture.add(first, &project, 9, 8, 0);
    fixture.add(second, &project, 1, 2, 0);
    let results = fixture.service.search("shared-search").unwrap();
    assert_eq!(results.len(), 1);
    let result = &results[0];
    assert_eq!(result.collection_id.as_deref(), Some(first.id.as_str()));
    assert_eq!(result.subtitle.as_deref(), Some(first.title.as_str()));
    assert_eq!(result.season_number, Some(9));
    assert_eq!(result.episode_number, Some(8));
}

#[test]
fn search_uses_the_matching_membership_when_only_its_alias_matches() {
    let fixture = Fixture::new();
    let a = fixture.collection("first");
    let b = fixture.collection("second");
    let (first, second) = if a.id < b.id { (&a, &b) } else { (&b, &a) };
    let project = fixture.project("ordinary.mp4");
    fixture.add(first, &project, 1, 2, 0);
    fixture.service.add_project_to_collection(AddProjectToCollectionInput {
        collection_id: second.id.clone(), project_id: project.id.clone(),
        season_number: Some(7), episode_number: Some(8), absolute_order: Some(0),
        display_title: Some("unique-alias".into()),
    }).unwrap();
    let result = fixture.service.search("unique-alias").unwrap().remove(0);
    assert_eq!(result.collection_id.as_deref(), Some(second.id.as_str()));
    assert_eq!(result.subtitle.as_deref(), Some(second.title.as_str()));
    assert_eq!((result.season_number, result.episode_number), (Some(7), Some(8)));
    let orphan = fixture.project("unclassified-search.mp4");
    let result = fixture.service.search("unclassified-search").unwrap().remove(0);
    assert_eq!(result.project_id.as_deref(), Some(orphan.id.as_str()));
    assert_eq!(result.kind, crate::library::SearchResultKind::Unclassified);
    assert!(result.collection_id.is_none());
}
