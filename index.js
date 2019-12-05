var fastn = require('fastn')(require('fastn/domComponents')());
var righto = require('righto');
var cpjax = require('cpjax');
var semver = require('semver');

var mutate = fastn.Model;
var binding = fastn.binding;
var state = {
    repo: 'korynunn/changelogit'
};


function createNewVersion(){
    return {
        commits: [],
        relevantCommits: []
    }
}

function relvantCommit(commit){
    var message = commit.commit.message;

    if(
        message.length <= 1 ||
        message.match(/Merge.*/) ||
        message.match(/Update README.md/)
    ){
        return false;
    }

    return true;
}

function parseCommitsToVersions(commits){
    var results = commits.reduce((results, commit) => {
        var lastVersion = results[results.length - 1];
        var message = commit.commit.message;
        var versionMatch = message.match(/\d+\.\d+\.\d+/);

        if(versionMatch){
            lastVersion = createNewVersion();
            results.push(lastVersion)
            lastVersion.version = versionMatch[0];
            lastVersion.date = commit.commit.committer.date;
            return results;
        }

        lastVersion.commits.push(commit);
        if(relvantCommit(commit)){
            lastVersion.relevantCommits.push(commit);
        }

        return results
    }, [createNewVersion()])

    var versions = results.reduce((versions, result) => {
        versions[result.version] = result;
        return versions;
    }, {})

    return versions;
}

function loadRateLimits(callback){
    mutate.set(state, 'loading', true);
    var rateLimits = righto(cpjax, 'https://api.github.com/rate_limit').get(JSON.parse);

    rateLimits.get(limits => mutate.set(state, 'rateLimits', limits))(() => {
        mutate.set(state, 'loading', false);
    });

    rateLimits(callback);
}

function loadCommits(nextPage, repo, callback){
    var url = nextPage;

    var rateLimits = righto(loadRateLimits);

    var commits = righto((rateLimits, done) => {
        if(!rateLimits.rate.remaining){
            return;
        }

        mutate.set(state, 'loading', true);
        cpjax(url, function(error, commits, response){
            mutate.set(state, 'loading', false);
            if(error){
                return done(error);
            }

            var linkHeader = response.target.getResponseHeader('link');
            var nextPageMatch = linkHeader && linkHeader.match(/.*<([^>]+)>; rel="next"/)

            done(null, {
                nextPage: nextPageMatch && nextPageMatch[1],
                commits: JSON.parse(commits)
            })
        })
    }, rateLimits);

    commits(callback);
}

function loadVersions(nextPage, repo, callback){
    var commits = righto(loadCommits, nextPage, repo);
    var nextPage = commits.get('nextPage');
    var versions = commits.get('commits').get(parseCommitsToVersions);

    var results = righto.resolve({
        nextPage,
        versions
    })

    results(callback)
}

function nextPage(){
    if(!state.nextPage || state.loading){
        return;
    }

    loadVersions(state.nextPage, state.repo, function(error, result){
        if(error){
            mutate.set(state, 'error', error);
        } else {
            mutate.set(state, 'nextPage', result.nextPage);
            mutate.update(state, 'versions', result.versions);
            checkScroll();
        }
    });
}

function updateRepo(){
    var repo = state.repo;
    if(!repo){
        return;
    }

    mutate.remove(state, 'versions');
    mutate.set(state, 'repo', repo);
    mutate.set(state, 'nextPage', `https://api.github.com/repos/${repo}/commits?per_page=100`);

    nextPage();
}

function checkScroll(){
    if(window.scrollY > document.body.offsetHeight - window.innerHeight - 1000){
        nextPage();
    }
}

function parseHash(){
    var repo = window.location.hash.slice(1);

    if(repo && repo !== state.repo){
        mutate.set(state, 'repo', repo);
        updateRepo();
    }
}

function setHash(){
    window.location.hash = state.repo;
    updateRepo();
}

function renderDate(dateString){
    if(!dateString){
        return '';
    }

    var date = new Date(dateString);

    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, 0)}-${date.getDate().toString().padStart(2, 0)}`
}

function renderCommit(){
    return fastn('div',
        fastn('h2', binding('commit.message', message => message.split('\n').filter(x => x)[0])),
        fastn('pre', binding('commit.message', message => message.split('\n').filter(x => x.trim()).slice(1).join('\n'))),
        'Author: ', binding('author.login')
    );
}

function renderCommits(commitsBinding){
    return fastn('list', {
        items: commitsBinding,
        template: () => {
            return renderCommit().binding('item')
        }
    });
}

function renderVersion(){
    return fastn('div',
        fastn('h1', binding('version', version => `${version || 'Unreleased'} ${version ? ' - ' : ''}`), binding('date', renderDate)),
        renderCommits(binding('relevantCommits|*'))
    );
}

var ui = fastn('div',
    fastn('h1', 'Github "changelog" viewer'),
    fastn('form', 
        fastn('input', { class: 'repo', value: binding('repo'), placeholder: 'user/repo', oninput: 'value:value' }),
        fastn('button', 'Load')
    ).on('submit', (event, scope) => {
        event.preventDefault();
        setHash();
    }),
    fastn('list', {
        items: binding('versions|*'),
        template: () => {
            return renderVersion().binding('item')
        }
    }),
    fastn('div', { class: 'notices' }, 
        fastn('h2', { display: binding('rateLimits.rate.remaining', remaining => !remaining) }, fastn.binding('rateLimits.rate|*', rate => rate && `Github API rate-limmited, limit released at ${new Date(rate.reset * 1000).toLocaleString()}`)),
        fastn('h2', { display: binding('loading') }, 'Loading...')
    ),
    fastn('button', { display: binding('nextPage', 'versions', 'loading', (nextPage, versions, loading) => nextPage && versions && !loading) }, 'Load more...').on('click', nextPage)
);

ui.attach(state);
ui.render();

window.addEventListener('load', () => document.body.appendChild(ui.element));
window.addEventListener('hashchange', parseHash)
window.addEventListener('scroll', checkScroll)
parseHash();
updateRepo();