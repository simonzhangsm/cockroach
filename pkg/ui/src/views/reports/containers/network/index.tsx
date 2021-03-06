import { deviation as d3Deviation, mean as d3Mean } from "d3";
import _ from "lodash";
import moment from "moment";
import React from "react";
import { connect } from "react-redux";
import { RouterState } from "react-router";

import { refreshLiveness, refreshNodes } from "src/redux/apiReducers";
import { LongToMoment, NanoToMilli } from "src/util/convert";
import { NodeFilterList } from "src/views/reports/components/nodeFilterList";
import { LivenessStatus, NodesSummary, nodesSummarySelector } from "src/redux/nodes";
import * as protos from "src/js/protos";
import { AdminUIState } from "src/redux/state";

interface NetworkOwnProps {
  nodesSummary: NodesSummary;
  refreshNodes: typeof refreshNodes;
  refreshLiveness: typeof refreshLiveness;
}

interface Identity {
  nodeID: number;
  address: string;
  locality: string;
  updatedAt: moment.Moment;
}

interface NoConnection {
  from: Identity;
  to: Identity;
}

type NetworkProps = NetworkOwnProps & RouterState;

function getNodeIDs(input: string) {
  const ids: Set<number> = new Set();
  if (!_.isEmpty(input)) {
    _.forEach(_.split(input, ","), nodeIDString => {
      const nodeID = parseInt(nodeIDString, 10);
      if (nodeID) {
        ids.add(nodeID);
      }
    });
  }
  return ids;
}

function localityToString(locality: protos.cockroach.roachpb.Locality$Properties) {
  return _.join(_.map(locality.tiers, (tier) => tier.key + "=" + tier.value), ",");
}

// staleTable is a table of all stale nodes.
function staleTable(staleIdentities: Identity[]) {
  if (_.isEmpty(staleIdentities)) {
    return null;
  }

  return (
    <div>
      <h2>Stale Nodes</h2>
      <table className="failure-table">
        <tbody>
          <tr className="failure-table__row failure-table__row--header">
            <td className="failure-table__cell failure-table__cell--header">
              Node
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              Address
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              Locality
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              Last Updated
              </td>
          </tr>
          {
            _.map(staleIdentities, (staleIdentity) => (
              <tr className="failure-table__row" key={staleIdentity.nodeID}>
                <td className="failure-table__cell">
                  n{staleIdentity.nodeID}
                </td>
                <td className="failure-table__cell">
                  {staleIdentity.address}
                </td>
                <td className="failure-table__cell">
                  {staleIdentity.locality}
                </td>
                <td className="failure-table__cell">
                  {staleIdentity.updatedAt.toString()}
                </td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  );
}

// noConnectionTable is a list of all good nodes that seem to be missing a connection.
function noConnectionTable(noConnections: NoConnection[]) {
  if (_.isEmpty(noConnections)) {
    return null;
  }

  return (
    <div>
      <h2>No Connections</h2>
      <table className="failure-table">
        <tbody>
          <tr className="failure-table__row failure-table__row--header">
            <td className="failure-table__cell failure-table__cell--header">
              From Node
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              From Address
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              From Locality
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              To Node
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              To Address
              </td>
            <td className="failure-table__cell failure-table__cell--header">
              To Locality
              </td>
          </tr>
          {
            _.map(noConnections, (noConn, k) => (
              <tr className="failure-table__row" key={k}>
                <td className="failure-table__cell">
                  n{noConn.from.nodeID}
                </td>
                <td className="failure-table__cell">
                  {noConn.from.address}
                </td>
                <td className="failure-table__cell">
                  {noConn.from.locality}
                </td>
                <td className="failure-table__cell">
                  n{noConn.to.nodeID}
                </td>
                <td className="failure-table__cell">
                  {noConn.to.address}
                </td>
                <td className="failure-table__cell">
                  {noConn.to.locality}
                </td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  );
}

// createHeaderCell creates and decorates a header cell.
function createHeaderCell(staleIDs: Set<number>, id: Identity, key: number) {
  const node = `n${id.nodeID.toString()}`;
  const title = _.join([node, id.address, id.locality], "\n");
  let className = "network-table__cell network-table__cell--header";
  if (staleIDs.has(id.nodeID)) {
    className = className + " network-table__cell--header-warning";
  }
  return <td key={key} className={className} title={title}>
    {node}
  </td>;
}

const noNodes = (
  <div>
    <h2>No nodes match the filters</h2>
  </div>
);

const loading = (
  <div className="section">
    <h1>Loading cluster status...</h1>
  </div>
);

/**
 * Renders the Network Diagnostics Report page.
 */
class Network extends React.Component<NetworkProps, {}> {
  refresh(props = this.props) {
    props.refreshLiveness();
    props.refreshNodes();
  }

  componentWillMount() {
    // Refresh nodes status query when mounting.
    this.refresh();
  }

  componentWillReceiveProps(nextProps: NetworkProps) {
    if (this.props.location !== nextProps.location) {
      this.refresh(nextProps);
    }
  }

  render() {
    const { nodesSummary } = this.props;
    if (_.isEmpty(nodesSummary.nodeIDs) || _.isEmpty(nodesSummary.livenessStatusByNodeID)) {
      return loading;
    }

    const requestedIDs = getNodeIDs(this.props.location.query.node_ids);
    let locality: RegExp = null;
    if (!_.isEmpty(this.props.location.query.locality)) {
      try {
        locality = new RegExp(this.props.location.query.locality);
      } catch (e) {
        // Ignore the error, the filter not appearing is feedback enough.
        locality = null;
      }
    }

    // List of node identities.
    const identityByID: Map<number, Identity> = new Map();
    _.forEach(nodesSummary.nodeStatuses, status => {
      identityByID.set(status.desc.node_id, {
        nodeID: status.desc.node_id,
        address: status.desc.address.address_field,
        locality: localityToString(status.desc.locality),
        updatedAt: LongToMoment(status.updated_at),
      });
    });

    // Calculate the mean and sampled standard deviation.
    let healthyIDsContext = _.chain(nodesSummary.nodeIDs)
      .filter(nodeID => nodesSummary.livenessStatusByNodeID[nodeID] === LivenessStatus.HEALTHY)
      .map(nodeID => Number.parseInt(nodeID, 0));
    let staleIDsContext = _.chain(nodesSummary.nodeIDs)
      .filter(nodeID => nodesSummary.livenessStatusByNodeID[nodeID] === LivenessStatus.SUSPECT)
      .map(nodeID => Number.parseInt(nodeID, 0));
    if (requestedIDs.size > 0) {
      healthyIDsContext = healthyIDsContext.filter(nodeID => requestedIDs.has(nodeID));
      staleIDsContext = staleIDsContext.filter(nodeID => requestedIDs.has(nodeID));
    }
    if (!_.isNil(locality)) {
      healthyIDsContext = healthyIDsContext.filter(nodeID => (
        !locality.test(localityToString(nodesSummary.nodeStatusByID[nodeID].desc.locality))
      ));
      staleIDsContext = staleIDsContext.filter(nodeID => (
        !locality.test(localityToString(nodesSummary.nodeStatusByID[nodeID].desc.locality))
      ));
    }
    const healthyIDs = healthyIDsContext.value();
    const staleIDs = new Set(staleIDsContext.value());
    const displayIdentities: Identity[] = healthyIDsContext
      .union(staleIDsContext.value())
      .map(nodeID => identityByID.get(nodeID))
      .sortBy(identity => identity.nodeID)
      .sortBy(identity => identity.locality)
      .value();
    const staleIdentities = staleIDsContext
      .map(nodeID => identityByID.get(nodeID))
      .sortBy(identity => identity.nodeID)
      .sortBy(identity => identity.locality)
      .value();

    const latencies = _.flatMap(healthyIDs, nodeIDa => (
      _.chain(healthyIDs)
        .without(nodeIDa)
        .map(nodeIDb => nodesSummary.nodeStatusByID[nodeIDa].latencies[nodeIDb])
        .map(latency => NanoToMilli(latency.toNumber()))
        .filter(ms => _.isFinite(ms) && ms > 0)
        .value()
    ));

    // TODO(bram): turn these values into memoized selectors.
    const mean = d3Mean(latencies);
    const stddev = d3Deviation(latencies);
    const stddevPlus1 = mean + stddev;
    const stddevPlus2 = stddevPlus1 + stddev;
    const stddevMinus1 = mean - stddev;
    const stddevMinus2 = stddevMinus1 - stddev;

    const noConnections: NoConnection[] = _.flatMap(healthyIDs, nodeIDa => (
      _.chain(nodesSummary.nodeStatusByID[nodeIDa].latencies)
        .keys()
        .map(nodeIDb => Number.parseInt(nodeIDb, 10))
        .difference(healthyIDs)
        .map(nodeIDb => ({
          from: identityByID.get(nodeIDa),
          to: identityByID.get(nodeIDb),
        }))
        .sortBy(noConnection => noConnection.to.nodeID)
        .sortBy(noConnection => noConnection.to.locality)
        .sortBy(noConnection => noConnection.from.nodeID)
        .sortBy(noConnection => noConnection.from.locality)
        .value()
    ));

    // getLatencyCell creates and decorates a cell based on it's latency.
    function getLatencyCell(nodeIDa: number, nodeIDb: number) {
      if (nodeIDa === nodeIDb) {
        return <td className="network-table__cell network-table__cell--self" key={nodeIDb}>
          -
        </td>;
      }
      if (staleIDs.has(nodeIDa) || staleIDs.has(nodeIDb)) {
        return <td className="network-table__cell network-table__cell--no-connection" key={nodeIDb}>
          X
        </td>;
      }
      const a = nodesSummary.nodeStatusByID[nodeIDa].latencies;
      if (_.isNil(a[nodeIDb])) {
        return <td className="network-table__cell network-table__cell--no-connection" key={nodeIDb}>
          X
        </td>;
      }
      const latency = NanoToMilli(a[nodeIDb].toNumber());
      let heat: string;
      if (latency > stddevPlus2) {
        heat = "stddev-plus-2";
      } else if (latency > stddevPlus1) {
        heat = "stddev-plus-1";
      } else if (latency < stddevMinus2) {
        heat = "stddev-minus-2";
      } else if (latency < stddevMinus1) {
        heat = "stddev-minus-1";
      } else {
        heat = "stddev-even";
      }
      const className = `network-table__cell network-table__cell--${heat}`;
      const title = `n${nodeIDa} -> n${nodeIDb}\n${latency.toString()}ms`;
      return <td className={className} title={title} key={nodeIDb}>
        {latency.toFixed(2)}ms
      </td>;
    }

    // latencyTable is the table and heat-map that's displayed for all nodes.
    const latencyTable = (
      <div>
        <h2>Latencies</h2>
        <table className="network-table">
          <tbody>
            <tr className="network-table__row">
              <td className="network-table__cell network-table__cell--spacer" />
              {
                _.map(displayIdentities, (identity) => createHeaderCell(staleIDs, identity, identity.nodeID))
              }
            </tr>
            {
              _.map(displayIdentities, (identityA) => (
                <tr key={identityA.nodeID} className="network-table__row">
                  {
                    createHeaderCell(staleIDs, identityA, 0)
                  }
                  {
                    _.map(displayIdentities, (identityB) => getLatencyCell(identityA.nodeID, identityB.nodeID))
                  }
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    );

    // legend is just a quick table showing the standard deviation values.
    const legend = (
      <div>
        <h2>Legend</h2>
        <table className="network-table">
          <tbody>
            <tr className="network-table__row">
              <td className="network-table__cell network-table__cell--header">
                &lt; -2 stddev
              </td>
              <td className="network-table__cell network-table__cell--header">
                &lt; -1 stddev
              </td>
              <td className="network-table__cell network-table__cell--header">
                mean
              </td>
              <td className="network-table__cell network-table__cell--header">
                &gt; +1 stddev
              </td>
              <td className="network-table__cell network-table__cell--header">
                &gt; +2 stddev
              </td>
            </tr>
            <tr className="network-table__row">
              <td className="network-table__cell network-table__cell--stddev-minus-2">
                {stddevMinus2.toFixed(2)}ms
              </td>
              <td className="network-table__cell network-table__cell--stddev-minus-1">
                {stddevMinus1.toFixed(2)}ms
              </td>
              <td className="network-table__cell network-table__cell--stddev-even">
                {mean.toFixed(2)}ms
              </td>
              <td className="network-table__cell network-table__cell--stddev-plus-1">
                {stddevPlus1.toFixed(2)}ms
              </td>
              <td className="network-table__cell network-table__cell--stddev-plus-2">
                {stddevPlus2.toFixed(2)}ms
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );

    function displayResults() {
      if (_.isEmpty(displayIdentities)) {
        return noNodes;
      }
      return (
        <div>
          {latencyTable}
          {legend}
        </div>
      );
    }

    return (
      <div>
        <h1>Network Diagnostics</h1>
        <NodeFilterList nodeIDs={requestedIDs} localityRegex={locality} />
        {displayResults()}
        {staleTable(staleIdentities)}
        {noConnectionTable(noConnections)}
      </div>
    );
  }
}

function mapStateToProps(state: AdminUIState) {
  return {
    nodesSummary: nodesSummarySelector(state),
  };
}

const actions = {
  refreshNodes,
  refreshLiveness,
};

export default connect(mapStateToProps, actions)(Network);
