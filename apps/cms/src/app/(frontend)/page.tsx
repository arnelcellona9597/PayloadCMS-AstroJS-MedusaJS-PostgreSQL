import { headers as getHeaders } from 'next/headers.js'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

/**
 * A deliberately plain landing page.
 *
 * Payload 3 is not standalone — it mounts INTO a Next.js app. This route group,
 * `(frontend)`, is the part of that Next app which is yours; the `(payload)`
 * group next to it is Payload's admin panel and API, and you should not need to
 * touch it.
 *
 * In this project the public frontend is Astro on :4321, so this page exists
 * only to orient you and to prove the Local API works.
 */
export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const { user } = await payload.auth({ headers: await getHeaders() })

  const [posts, categories, media] = await Promise.all([
    payload.count({ collection: 'posts' }),
    payload.count({ collection: 'categories' }),
    payload.count({ collection: 'media' }),
  ])

  return (
    <div className="home">
      <div className="content">
        <h1>Payload CMS</h1>
        <p>
          {user ? (
            <>
              Signed in as <strong>{user.email}</strong>.
            </>
          ) : (
            <>Not signed in.</>
          )}
        </p>

        <p className="counts">
          <span>{posts.totalDocs} posts</span>
          <span>{categories.totalDocs} categories</span>
          <span>{media.totalDocs} media</span>
        </p>

        <p className="note">
          These numbers came from the <strong>Local API</strong> — in-process
          calls, no HTTP. The same data over REST is at <code>/api/posts</code>.
        </p>

        <div className="links">
          <a className="admin" href="/admin">
            Admin panel
          </a>
          <a className="docs" href="/api/posts?limit=3" rel="noopener">
            REST: /api/posts
          </a>
          <a className="docs" href="/api/posts/stats" rel="noopener">
            Custom endpoint: /api/posts/stats
          </a>
          <a className="docs" href="/api/graphql-playground" rel="noopener">
            GraphQL playground
          </a>
          <a className="docs" href="http://localhost:4321" rel="noopener">
            Astro storefront →
          </a>
        </div>
      </div>
    </div>
  )
}
