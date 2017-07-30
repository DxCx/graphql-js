import { describe, it } from 'mocha';
import {
  expectPassesRule,
  expectFailsRule,
} from './harness';
import {
  NoReactiveMutations,
  noReactiveDirectivesMessage,
} from '../rules/NoReactiveMutations';


describe('Validate: Mutation without reactive directives', () => {

  it('valid mutation', () => {
    expectPassesRule(NoReactiveMutations, `
      mutation likePost {
        likePost(id: "1") {
          likeCount
        }
      }
    `);
  });

  it('effects only mutation', () => {
    expectPassesRule(NoReactiveMutations, `
      subscription postsLikeDeferred {
        newCommentForPost(id: "1") {
          likeCount @defer
        }
      }

      mutation likePost {
        likePost(id: "1") {
          likeCount
        }
      }

      query postsLikesLive {
        posts {
          likeCount @live
        }
      }
    `);
  });

  it('doesn\'t error on non-reactive directive', () => {
    expectPassesRule(NoReactiveMutations, `
      mutation likePost($shouldInclude: Boolean) {
        likePost(id: "1") {
          likeCount @include(if: $shouldInclude)
        }
      }
    `);
  });

  it('fails with defer', () => {
    expectFailsRule(NoReactiveMutations, `
      mutation likePost {
        likePost(id: "1") @defer {
          likeCount
        }
      }
    `, [ {
      message: noReactiveDirectivesMessage('likePost'),
      locations: [ { line: 3, column: 27 } ],
      path: undefined,
    } ]);
  });

  it('fails for inner fields as well', () => {
    expectFailsRule(NoReactiveMutations, `
      mutation likePost {
        likePost(id: "1") {
          likeCount @live
        }
      }
    `, [ {
      message: noReactiveDirectivesMessage('likePost'),
      locations: [ { line: 4, column: 21 } ],
      path: undefined,
    } ]);
  });
});

